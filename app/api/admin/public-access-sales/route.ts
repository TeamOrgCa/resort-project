import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { validatePublicAccessInput } from "@/lib/public-access/sales";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";
import { contentImageExtension } from "@/lib/settings/content-images";

export async function POST(request: Request) {
  try {
    const response = await recordPublicAccess(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ success: false, message: "Unable to confirm this collection. Check the ledger and retry the same admission form." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

async function recordPublicAccess(request: Request) {
  const staff = await requireActiveStaff();
  if (!staff) return NextResponse.json({ success:false,message:"Sign in with your cashier account." },{status:401});
  if (staff.staffUser.role!=="cashier" || !await staffHasPermission(staff.supabase,"cashier","transactions") || !await staffHasPermission(staff.supabase,"cashier","payment_entry"))
    return NextResponse.json({success:false,message:"Cashier Transactions and Record payments permission required."},{status:403});
  const {value,error}=validatePublicAccessInput(await request.json().catch(()=>null));
  if(!value)return NextResponse.json({success:false,message:error},{status:400});
  const {data:method,error:methodError}=await staff.supabase.from("payment_methods").select("name,type").eq("payment_method_id",value.paymentMethodId).maybeSingle();
  if(methodError)return NextResponse.json({success:false,message:"Unable to check payment method. Retry with the same admission form."},{status:503});
  if(!method)return NextResponse.json({success:false,message:"Payment method not found."},{status:400});
  const cash=method.name.trim().toLowerCase()==="cash"||String(method.type??"").trim().toLowerCase()==="cash";
  if(!cash){
    if(typeof value.paymentReference!=="string"||!/^[A-Za-z0-9-]{6,100}$/.test(value.paymentReference.trim())||typeof value.proofPath!=="string"||!value.proofPath.startsWith(`${staff.staffUser.id}/staff/`)||value.proofPath.includes(".."))
      return NextResponse.json({success:false,message:"Enter the real transfer reference and upload payment proof."},{status:400});
    const {data:file,error:proofError}=await staff.supabase.storage.from(PAYMENT_PROOF_BUCKET).download(value.proofPath);
    if(proofError||!file||file.size<1||file.size>MAX_PAYMENT_PROOF_BYTES)return NextResponse.json({success:false,message:"Upload JPEG, PNG, WebP or PDF proof up to 8 MB."},{status:400});
    const bytes=new Uint8Array(await file.arrayBuffer());
    const valid=file.type==="application/pdf"?String.fromCharCode(...bytes.slice(0,5))==="%PDF-":Boolean(contentImageExtension(bytes,file.type));
    if(!valid)return NextResponse.json({success:false,message:"The proof file is not a supported image or PDF."},{status:400});
  }
  const {data,error:saveError}=await staff.supabase.rpc("record_public_access_sale",{p_request:value.requestId,p_guest:value.guestName,p_contact:value.contactNumber,p_type:value.accessType,
    p_payment_for:value.paymentFor,p_amount:value.amount,p_method:value.paymentMethodId,p_reference:cash?null:value.paymentReference?.trim(),p_proof:cash?null:value.proofPath,p_received:true});
  if(saveError||!data)return NextResponse.json({success:false,message:saveError?.code==="PGRST202"?"Apply the public-access-sales migration before recording admissions.":saveError?.message??"Unable to confirm collection. Check the ledger and retry the same form."},
    {status:saveError?.code==="42501"?403:saveError?.code==="40001"||saveError?.code==="23505"?409:saveError?.code==="22023"?400:503});
  return NextResponse.json({success:true,...data,message:data.alreadyRecorded?"This admission was already recorded; no duplicate collection was created.":"Public access payment recorded and receipt issued."},{status:data.alreadyRecorded?200:201});
}
