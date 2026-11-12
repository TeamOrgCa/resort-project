import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const staff='11111111-1111-4111-8111-111111111111',method='22222222-2222-4222-8222-222222222222';
const base={reservationId:'reservation',amount:1000,expectedBalance:2400,paymentMethod:'non_cash',paymentMethodId:method,
  paymentReference:'BANK-123456789',fundsReceived:true,accountName:'Maria Cruz',accountNumber:'09171234567',proofPath:`${staff}/staff/proof.pdf`};
function harness({role='cashier',permission=true,active=true,proof=new Blob(['%PDF-test'],{type:'application/pdf'}),rpcError=null,replayed=false,mailFails=false}={}){
 const calls=[],downloads=[],mail=[];
 const supabase={storage:{from:bucket=>({download:async path=>{downloads.push({bucket,path});return{data:proof,error:proof?null:{message:'Missing proof'}};}})},
  rpc:async(name,args)=>{calls.push({name,args});return{error:rpcError,data:rpcError?null:{payment:{payment_id:'payment',amount:1000},receipt:{receipt_number:'RCPT-OTHER'},reservation:{reservation_id:'reservation',guest_id:null},remainingBalance:1400,alreadyRecorded:replayed}};}};
 const {POST}=loadTsModule('app/api/admin/payments/manual-entry/route.ts',{
  '@/lib/server/admin-audit':{requireActiveStaff:async()=>active?{staffUser:{id:staff,role},supabase}:null},
  '@/lib/server/role-permissions':{staffHasPermission:async()=>permission},
  '@/lib/server/billing-email':{emailBillingDocuments:async()=>{mail.push(true);if(mailFails)throw Error('SMTP down');return{receiptSent:true,invoiceSent:true};}},
  '@/lib/notifications':{createNotifications:async()=>({error:null})},
  '@/lib/email':{sendReservationConfirmedEmail:async()=>true},
 });
 return{calls,downloads,mail,post:(payload={})=>POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({...base,...payload})}))};
}

test('cashier records the selected catalog method atomically with real reference, proof and received-funds acknowledgement',async()=>{
 const h=harness();const response=await h.post(),body=await response.json();assert.equal(response.status,201);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'record_staff_payment');
 assert.equal(h.calls[0].args.p_method,method);assert.equal(h.calls[0].args.p_received,true);assert.equal(h.calls[0].args.p_expected_balance,2400);
 assert.equal(h.calls[0].args.p_reference,base.paymentReference);assert.equal(h.calls[0].args.p_proof,base.proofPath);
 assert.equal(body.receipt.receipt_number,'RCPT-OTHER');assert.equal(body.remainingBalance,1400);assert.equal(h.mail.length,1);
});

test('other payment entry requires the active staff role, grant, valid money and sender/transaction details',async()=>{
 for(const options of[{active:false},{permission:false},{role:'admin'}]){
  const h=harness(options);assert.ok([401,403].includes((await h.post()).status));assert.equal(h.calls.length,0);
 }
 for(const payload of[{fundsReceived:false},{amount:0},{amount:1.001},{expectedBalance:undefined},{paymentMethodId:'ewallet'},
  {accountName:'Name123'},{accountNumber:'abc'},{paymentReference:'123!abc'},{proofPath:'other/staff/proof.pdf'}]){
  const h=harness();assert.equal((await h.post(payload)).status,400);assert.equal(h.calls.length,0);
 }
});

test('missing, oversized and disguised proof files are rejected before payment recording',async()=>{
 for(const proof of[null,new Blob(['not a PDF'],{type:'application/pdf'}),new Blob(['a'],{type:'text/plain'}),new Blob([new Uint8Array(8*1024*1024+1)],{type:'image/png'})]){
  const h=harness({proof});assert.equal((await h.post()).status,400);assert.equal(h.calls.length,0);
 }
});

test('non-cash retries keep their receipt without resending billing and conflict errors do not send mail',async()=>{
 const retry=harness({replayed:true});assert.equal((await retry.post()).status,200);assert.equal(retry.mail.length,0);
 const quiet=console.error;console.error=()=>{};
 try{for(const [code,status] of[['23505',409],['40001',409],['42501',403],['22023',400],['PGRST202',503]]){
  const h=harness({rpcError:{code,message:'Payment blocked'}});const r=await h.post();assert.equal(r.status,status);assert.equal(h.mail.length,0);
 }}finally{console.error=quiet;}
});

test('a committed other-method payment remains successful if billing delivery fails',async()=>{
 const warn=console.warn;console.warn=()=>{};
 try{const h=harness({mailFails:true});const r=await h.post(),body=await r.json();assert.equal(r.status,201);assert.equal(body.success,true);assert.match(body.billingEmails.error,/payment was saved/);}
 finally{console.warn=warn;}
});
