"use client";
import { useRef, useState } from "react";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";
import { createClient } from "@/lib/supabase/client";
import { PUBLIC_ACCESS_TYPES, validatePublicAccessInput, type PublicAccessSale, type PublicAccessType } from "@/lib/public-access/sales";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";
import type { StaffPaymentMethod } from "./RecordPaymentDialog";

export default function PublicAccessPaymentDialog({ methods, onSaved, onClose }: {methods:StaffPaymentMethod[];onSaved:(sale:PublicAccessSale,message:string)=>void;onClose:()=>void}) {
  const [requestId]=useState(()=>crypto.randomUUID());
  const [guestName,setGuestName]=useState(""),[contactNumber,setContactNumber]=useState(""),[paymentFor,setPaymentFor]=useState("");
  const [accessType,setAccessType]=useState<PublicAccessType>("swimming"),[amount,setAmount]=useState("");
  const [methodId,setMethodId]=useState(()=>methods.find(m=>m.type.toLowerCase()==="cash"||m.name.toLowerCase()==="cash")?.payment_method_id??methods[0]?.payment_method_id??"");
  const [reference,setReference]=useState(""),[file,setFile]=useState<File|null>(null),[proofPath,setProofPath]=useState("");
  const [received,setReceived]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const saving=useRef(false), method=methods.find(m=>m.payment_method_id===methodId);
  const cash=method?.type.trim().toLowerCase()==="cash"||method?.name.trim().toLowerCase()==="cash";
  const field="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white p-3 text-base text-black";
  async function submit(){
    if(saving.current)return;
    const {value,error:validation}=validatePublicAccessInput({requestId,guestName,contactNumber,paymentFor,accessType,amount:Number(amount),paymentMethodId:methodId,fundsReceived:received});
    if(!value){setError(validation??"Check the admission details.");return;}
    if(!method||(!cash&&(!/^[A-Za-z0-9-]{6,100}$/.test(reference.trim())||!file))){setError("Select a payment method and provide its transfer reference and proof.");return;}
    saving.current=true;setBusy(true);setError(null);
    try{
      let path=proofPath;
      if(!cash&&!path){
        if(!file||file.size<1||file.size>MAX_PAYMENT_PROOF_BYTES||!["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type))throw Error("Upload JPEG, PNG, WebP or PDF proof up to 8 MB.");
        const client=createClient(),{data:{user}}=await client.auth.getUser();if(!user)throw Error("Sign in again before recording a collection.");
        const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"}[file.type];
        path=`${user.id}/staff/${crypto.randomUUID()}.${ext}`;
        const {error:uploadError}=await client.storage.from(PAYMENT_PROOF_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
        if(uploadError)throw Error("Unable to upload proof. Retry this admission form.");setProofPath(path);
      }
      const response=await fetch("/api/admin/public-access-sales",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...value,paymentReference:cash?undefined:reference.trim(),proofPath:cash?undefined:path})});
      const result=await response.json();if(!response.ok||!result.success)throw Error(result.message??"Unable to confirm collection. Check the ledger before retrying.");
      onSaved(result.sale,result.message);
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to record admission.");}
    finally{saving.current=false;setBusy(false);}
  }
  return <CatalogDialog title="Public access payment" description="Record public swimming, cottage or room usage already paid to the resort. Private-booking balances use Settle payment on their ledger row." busy={busy} onClose={()=>{if(!saving.current)onClose();}}>
    <form onSubmit={event=>{event.preventDefault();void submit();}} className="space-y-4">
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <label className="block text-sm font-medium">Guest name<input data-autofocus required maxLength={100} value={guestName} onChange={e=>setGuestName(e.target.value)} className={field}/></label>
        <label className="block text-sm font-medium">Contact no.<input required type="tel" placeholder="09171234567" value={contactNumber} onChange={e=>setContactNumber(e.target.value)} className={field}/></label>
        <label className="block text-sm font-medium">Public access usage<select value={accessType} onChange={e=>setAccessType(e.target.value as PublicAccessType)} className={field}>{Object.entries(PUBLIC_ACCESS_TYPES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block text-sm font-medium">Payment for<textarea required minLength={3} maxLength={2000} rows={3} placeholder="Example: Swimming admission for 4 adults and 1 cottage" value={paymentFor} onChange={e=>setPaymentFor(e.target.value)} className={field}/></label>
        <label className="block text-sm font-medium">Amount received (PHP)<input required type="number" min="0.01" max="99999999.99" step="0.01" value={amount} onChange={e=>{setAmount(e.target.value);setReceived(false);}} className={field}/></label>
        <label className="block text-sm font-medium">Payment method<select required value={methodId} onChange={e=>{setMethodId(e.target.value);setReference("");setFile(null);setProofPath("");setReceived(false);}} className={field}>{!methods.length&&<option value="">No active payment methods</option>}{methods.map(m=><option key={m.payment_method_id} value={m.payment_method_id}>{m.name}</option>)}</select></label>
        {!cash&&<><label className="block text-sm font-medium">Transaction reference<input required value={reference} onChange={e=>setReference(e.target.value)} className={field}/></label><label className="block text-sm font-medium">Payment proof<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>{setFile(e.target.files?.[0]??null);setProofPath("");}} className={field}/></label></>}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" required checked={received} onChange={e=>setReceived(e.target.checked)} className="mt-1 h-4 w-4"/>I have received and checked this payment. For transfers, I verified the money in the resort&apos;s receiving account.</label>
      </fieldset>
      {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button type="submit" disabled={busy||!methods.length} className="admin-button-primary">{busy?"Recording...":"Record admission and issue receipt"}</button>
    </form>
  </CatalogDialog>;
}
