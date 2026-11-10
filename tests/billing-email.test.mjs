import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function harness({enabled=true,receiptSent=false,invoiceSent=false,receiptDelivery=true,invoiceDelivery=true,walkIn=false,guestEmail="guest@example.com",settingError=false,markError=false,serverAvailable=true,serverEnabled=true}={}){
  const sent=[],recorded=[],serverWrites=[];
  const reservation={reservation_id:"reservation",guest_id:walkIn?null:"guest",walk_in_guest_id:walkIn?"offline":null,reference_number:"MV-TEST",start_datetime:"2027-01-15T04:30:00Z",end_datetime:"2027-01-15T08:00:00Z"};
  const rows={guests:{email:guestEmail,first_name:"José",last_name:"Muñoz"},walk_in_guests:{email:guestEmail,first_name:"Offline",last_name:"Guest"},
    receipts:{receipt_id:"receipt",receipt_number:"RCP-TEST",issued_at:"2027-01-15T04:00:00Z",email_sent:receiptSent,amount_paid:2500,transaction_total_at_time:10000,balance_after_payment:7500,billed_to_name:"José Muñoz"},
    invoices:{invoice_id:"invoice",created_at:"2027-01-10",status:"paid",total_amount:10000,email_sent:invoiceSent},
    transactions:{total_amount:10000,paid_amount:10000,balance:0},reservations:{booking_mode:"day",adult_count:10,child_count:0,adult_rate_at_booking:null,child_rate_at_booking:null},
    reservation_units:[{quantity:1,price_per_night:10000,units:{name:"Private pool"}}],reservation_services:[],payments:{reference_number:"CASH-TEST123456",payment_methods:{name:"Cash"}}};
  const client={rpc:async(name,args)=>{if(name==="billing_email_enabled")return {data:enabled,error:settingError?{code:"PGRST202",message:"Function missing"}:null};recorded.push(args);return {data:null,error:markError?{code:"PGRST202",message:"Function missing"}:null};},from:table=>{
    const q={select:()=>q,eq:()=>q,neq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:rows[table],error:null}),then:(resolve,reject)=>Promise.resolve({data:rows[table],error:null}).then(resolve,reject)};return q;
  }};
  const server={from:table=>{const query={select:()=>query,eq:()=>query,update:value=>{serverWrites.push({table,value});return query;},maybeSingle:async()=>({data:{setting_value:{emailEnabled:serverEnabled}},error:null}),then:(resolve,reject)=>Promise.resolve({error:null}).then(resolve,reject)};return query;}};
  const {emailBillingDocuments}=loadTsModule("lib/server/billing-email.ts",{"@/lib/supabase/admin":{tryCreateAdminClient:()=>serverAvailable?server:null},"@/lib/email":{
    sendPaymentReceiptEmail:async payload=>{sent.push(["receipt",payload]);return receiptDelivery;},
    sendReservationInvoiceEmail:async payload=>{sent.push(["invoice",payload]);return invoiceDelivery;},
  }});
  return {sent,recorded,serverWrites,send:()=>emailBillingDocuments(client,reservation,"payment",2500)};
}
test("new verified payments email both documents and preserve the issued receipt snapshot",async()=>{
  const h=harness();assert.deepEqual(await h.send(),{receiptSent:true,invoiceSent:true});
  const receipt=h.sent.find(([kind])=>kind==="receipt")[1],invoice=h.sent.find(([kind])=>kind==="invoice")[1];
  assert.equal(receipt.balance,7500);assert.equal(receipt.amountPaid,2500);assert.equal(receipt.paymentMethod,"Cash");
  assert.equal(invoice.balance,0);assert.equal(invoice.paidAmount,10000);assert.equal(invoice.invoiceId,"invoice");
  assert.equal(h.recorded.length,2);assert.ok(h.recorded.every(record=>record.p_sent));
});
test("settling cash sends the updated invoice even when an earlier invoice was already emailed",async()=>{
  const h=harness({invoiceSent:true});await h.send();assert.equal(h.sent.length,2);
  const duplicate=harness({invoiceSent:true,receiptSent:true});await duplicate.send();assert.equal(duplicate.sent.length,0);
});
test("delivery failures remain retryable and configuration and optional offline emails are respected",async()=>{
  const failed=harness({receiptDelivery:false,invoiceDelivery:false});const failure=await failed.send();assert.equal(failure.receiptSent,false);assert.equal(failure.invoiceSent,false);assert.match(failure.error,/could not be sent/);
  assert.ok(failed.recorded.every(record=>record.p_sent===false&&record.p_error));
  const disabled=harness({enabled:false});await disabled.send();assert.equal(disabled.sent.length,0);
  const offline=harness({walkIn:true});await offline.send();assert.equal(offline.sent.length,2);
  const missing=harness({walkIn:true,guestEmail:null});await missing.send();assert.equal(missing.sent.length,0);
});

test("a missing billing RPC no longer prevents cashier billing emails and delivery metadata is recorded safely",async()=>{
  const h=harness({settingError:true,markError:true});assert.deepEqual(await h.send(),{receiptSent:true,invoiceSent:true});
  assert.equal(h.sent.length,2);assert.equal(h.serverWrites.length,2);
  assert.ok(h.serverWrites.every(row=>row.value.email_sent===true));
});
test("server fallback respects disabled receipt settings and reports unavailable configuration",async()=>{
  const disabled=harness({settingError:true,serverEnabled:false});assert.match((await disabled.send()).error,/disabled in Configuration/);assert.equal(disabled.sent.length,0);
  const missing=harness({settingError:true,serverAvailable:false});assert.match((await missing.send()).error,/setting could not be read/);assert.equal(missing.sent.length,0);
});
test("a failed updated invoice is not reported as already sent just because its earlier version was emailed",async()=>{
  const h=harness({invoiceSent:true,invoiceDelivery:false});const result=await h.send();assert.equal(result.receiptSent,true);assert.equal(result.invoiceSent,false);assert.equal(result.invoiceAlreadySent,undefined);assert.match(result.error,/could not be sent/);
});
