import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

function harness({enabled=true,receiptSent=false,invoiceSent=false,receiptDelivery=true,invoiceDelivery=true,walkIn=false,guestEmail="guest@example.com",settingError=false,markError=false,serverAvailable=true,serverEnabled=true,paymentPatch={},statementServer=false,invoiceThrows=false}={}){
  const sent=[],recorded=[],serverWrites=[],queries=[];
  const reservation={reservation_id:"reservation",guest_id:walkIn?null:"guest",walk_in_guest_id:walkIn?"offline":null,reference_number:"MV-TEST",start_datetime:"2027-01-15T04:30:00Z",end_datetime:"2027-01-15T08:00:00Z"};
  const rows={guests:{email:guestEmail,first_name:"José",last_name:"Muñoz"},walk_in_guests:{email:guestEmail,first_name:"Offline",last_name:"Guest"},
    receipts:{receipt_id:"receipt",receipt_number:"RCP-TEST",issued_at:"2027-01-15T04:00:00Z",email_sent:receiptSent,amount_paid:2500,transaction_total_at_time:10000,balance_after_payment:7500,billed_to_name:"José Muñoz"},
    invoices:{invoice_id:"invoice",created_at:"2027-01-10",status:"paid",total_amount:10000,email_sent:invoiceSent},
    transactions:{total_amount:10000,paid_amount:10000,balance:0},reservations:{booking_mode:"day",adult_count:10,child_count:0,adult_rate_at_booking:null,child_rate_at_booking:null},
    reservation_units:[{quantity:1,price_per_night:10000,units:{name:"Private pool"}}],reservation_services:[],payments:{reference_number:"CASH-TEST123456",payment_methods:{name:"Cash"}}};
  Object.assign(rows.payments,{paid_at:"2027-01-15T03:50:00Z",receipt_paid_at:null},paymentPatch);
  const client={rpc:async(name,args)=>{if(name==="billing_email_enabled")return {data:enabled,error:settingError?{code:"PGRST202",message:"Function missing"}:null};recorded.push(args);return {data:null,error:markError?{code:"PGRST202",message:"Function missing"}:null};},from:table=>{
    queries.push(table);
    let selection="";
    const q={select:value=>{selection=value;return q;},eq:()=>q,neq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:table==="reservations"&&selection.startsWith("reservation_id,")?reservation:rows[table],error:null}),then:(resolve,reject)=>Promise.resolve({data:rows[table],error:null}).then(resolve,reject)};return q;
  }};
  const server={from:table=>{const query={select:()=>query,eq:()=>query,update:value=>{serverWrites.push({table,value});return query;},maybeSingle:async()=>({data:{setting_value:{emailEnabled:serverEnabled}},error:null}),then:(resolve,reject)=>Promise.resolve({error:null}).then(resolve,reject)};return query;}};
  const {emailBillingDocuments,emailUpdatedBillingStatement}=loadTsModule("lib/server/billing-email.ts",{"@/lib/supabase/admin":{tryCreateAdminClient:()=>serverAvailable?(statementServer?client:server):null},"@/lib/email":{
    sendPaymentReceiptEmail:async payload=>{sent.push(["receipt",payload]);return receiptDelivery;},
    sendReservationInvoiceEmail:async payload=>{sent.push(["invoice",payload]);if(invoiceThrows)throw Error("Mail provider unavailable");return invoiceDelivery;},
  }});
  return {sent,recorded,serverWrites,rows,queries,send:()=>emailBillingDocuments(client,reservation,"payment",2500),updateCommitted:()=>emailUpdatedBillingStatement(reservation.reservation_id,10000),
    update:(expectedTotal=10000)=>emailBillingDocuments(client,reservation,null,0,{invoiceOnly:true,expectedTotal,updatedAt:"2027-01-16T00:00:00Z"})};
}
test("new verified payments email both documents and preserve the issued receipt snapshot",async()=>{
  const h=harness();assert.deepEqual(await h.send(),{receiptSent:true,invoiceSent:true});
  const receipt=h.sent.find(([kind])=>kind==="receipt")[1],invoice=h.sent.find(([kind])=>kind==="invoice")[1];
  assert.equal(receipt.balance,7500);assert.equal(receipt.amountPaid,2500);assert.equal(receipt.paymentMethod,"Cash");
  assert.equal(receipt.paymentReference,"CASH-TEST123456");assert.equal(receipt.paidAt,"2027-01-15T03:50:00Z");
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

test("receipt emails prefer the provider timestamp and actual reference while preserving historical amounts",async()=>{
  const h=harness({paymentPatch:{payment_methods:{name:"GCash"},reference_number:"INTERNAL-BETA-123",beta_receipt_reference:"1234567890123",receipt_paid_at:"2027-01-14T16:10:00Z"}});
  await h.send();const receipt=h.sent[0][1];
  assert.equal(receipt.paymentReference,"1234567890123");assert.equal(receipt.paymentMethod,"GCash");assert.equal(receipt.paidAt,"2027-01-14T16:10:00Z");
  assert.equal(receipt.amountPaid,2500);assert.equal(receipt.balance,7500);
  const legacy=harness({paymentPatch:{paid_at:null,receipt_paid_at:null}});await legacy.send();assert.equal(legacy.sent[0][1].paidAt,null);
});

test("service edits resend the current itemized statement without reading or resending a historical receipt",async()=>{
  const h=harness({invoiceSent:true,receiptSent:true});
  h.rows.reservation_services=[{quantity:2,price_at_time:250,services:{name:"Extra mattress"}}];
  h.rows.invoices.total_amount=10500;h.rows.transactions={total_amount:10500,paid_amount:10000,balance:500};
  const result=await h.update(10500);
  assert.equal(result.invoiceSent,true);assert.equal(result.receiptSent,false);assert.equal(result.error,undefined);
  assert.equal(h.sent.length,1);const [kind,statement]=h.sent[0];assert.equal(kind,"invoice");
  assert.equal(statement.updatedAt,"2027-01-16T00:00:00Z");assert.equal(statement.totalAmount,10500);assert.equal(statement.paidAmount,10000);assert.equal(statement.balance,500);
  assert.ok(statement.breakdown.lines.some(line=>line.description==="Extra mattress"&&line.quantity===2&&line.amount===500));
  assert.ok(!h.queries.includes("receipts"));assert.ok(!h.queries.includes("payments"));
  assert.equal(statement.paymentMethod,undefined);assert.equal(statement.paymentReference,undefined);
  assert.deepEqual(h.recorded.map(record=>record.p_document_type),["invoice"]);
});

test("removing services sends the reduced total and preserves verified payments",async()=>{
  const h=harness({invoiceSent:true});h.rows.invoices.total_amount=9500;h.rows.transactions={total_amount:9500,paid_amount:10000,balance:0};
  await h.update(9500);const statement=h.sent[0][1];assert.equal(statement.totalAmount,9500);assert.equal(statement.paidAmount,10000);assert.equal(statement.balance,0);
  assert.ok(!statement.breakdown.lines.some(line=>line.description==="Extra mattress"));
});

test("pending bookings can receive a current statement before their first invoice exists",async()=>{
  const h=harness();h.rows.invoices=null;h.rows.transactions.paid_amount=0;h.rows.transactions.balance=10000;
  const result=await h.update();assert.equal(result.invoiceSent,true);assert.equal(result.error,undefined);
  assert.equal(h.sent[0][1].invoiceId,undefined);assert.equal(h.sent[0][1].paidAmount,0);assert.equal(h.recorded.length,0);
});

test("updated statements respect settings, recipient availability, failures and concurrent bill changes",async()=>{
  for(const options of [{enabled:false},{guestEmail:null}]){const h=harness(options);assert.ok((await h.update()).error);assert.equal(h.sent.length,0);}
  const stale=harness();assert.match((await stale.update(10500)).error,/changed again/);assert.equal(stale.sent.length,0);
  const mismatch=harness();mismatch.rows.invoices.total_amount=9500;assert.match((await mismatch.update()).error,/changed again/);assert.equal(mismatch.sent.length,0);
  const failed=harness({invoiceSent:true,invoiceDelivery:false});assert.match((await failed.update()).error,/could not be sent/);assert.equal(failed.recorded[0].p_sent,false);
});

test("statement follow-up returns an error instead of throwing when the server or mail provider is unavailable",async()=>{
  for(const tryCreateAdminClient of [()=>null,()=>{throw Error("Unavailable");}]){
    const {emailUpdatedBillingStatement}=loadTsModule("lib/server/billing-email.ts",{"@/lib/supabase/admin":{tryCreateAdminClient},"@/lib/email":{}});
    const result=await emailUpdatedBillingStatement("reservation",10000);assert.equal(result.sent,false);assert.ok(result.error);
  }
  const delivered=harness({statementServer:true,invoiceSent:true});assert.deepEqual(await delivered.updateCommitted(),{sent:true});assert.equal(delivered.sent.length,1);assert.ok(delivered.sent[0][1].updatedAt);
  const unavailable=harness({statementServer:true,invoiceThrows:true});const result=await unavailable.updateCommitted();assert.equal(result.sent,false);assert.match(result.error,/could not be emailed/);
});
