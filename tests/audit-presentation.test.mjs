import test from "node:test";
import assert from "node:assert/strict";
import {loadTsModule} from "./helpers/load-ts-module.mjs";
import {dashboardDatabase} from "./helpers/dashboard-database.mjs";
const {auditAction,auditSummary}=loadTsModule("lib/admin/audit-presentation.ts");
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;

test("reservation edits explain actual count, service and bill changes without treating omitted fields as deletions",()=>{
  const labels=new Map([[id(4),"Extra mattress"]]);
  const summary=auditSummary({before:{adult_count:20,child_count:2,special_requests:"Original request",start_datetime:"2026-11-13T00:00:00Z"},
    after:{adultCount:22,childCount:2,services:[{serviceId:id(4),quantity:3}]},before_bill:{total_amount:7500},before_services:[{service_id:id(4),quantity:1,price:300}],new_total:8100,paid_amount:1500,balance:6600,reason:"Guest added two adults and mattresses"},labels,"reservation");
  assert.match(summary,/Adults: 20 → 22/);assert.match(summary,/Extra mattress × 1 → Extra mattress × 3/);
  assert.match(summary,/Booking total: ₱7,500\.00 → ₱8,100\.00/);assert.match(summary,/Verified payments: ₱1,500\.00/);
  assert.match(summary,/Remaining balance: ₱6,600\.00/);assert.match(summary,/Reason: Guest added/);
  assert.doesNotMatch(summary,/Children:|Original request|undefined|adult_count|serviceId|\{|11111111/);
});
test("refund entries distinguish authorization, transfer submission and verified completion",()=>{
  assert.match(auditAction("Refund approved"),/awaiting cashier transfer/);
  assert.match(auditAction("Refund payout_submitted"),/for manager verification/);
  assert.match(auditAction("Refund refunded"),/completed the refund/);
  const summary=auditSummary({old_status:"approved",new_status:"payout_submitted",amount:2000,reason:"Transferred to guest",proof_path:"private/proof.png",verified:false},new Map(),"refund_request");
  assert.match(summary,/Approved; awaiting cashier transfer → Transfer submitted; awaiting manager verification/);
  assert.match(summary,/Amount: ₱2,000\.00/);assert.match(summary,/Verified: No/);assert.doesNotMatch(summary,/private\/|payout_submitted/);
});
test("timestamps, account access and role permissions use understandable language",()=>{
  const summary=auditSummary({before:{is_active:true},after:{is_active:false},checked_in_at:"2026-11-12T23:30:00Z",roles:[{role:"staff",permissions:["refund_approval","refund_verify"]}],reason:"Access revoked"},new Map(),"guest_account");
  assert.match(summary,/Account access: Active → Deactivated/);assert.match(summary,/Nov 13, 2026/);assert.match(summary,/Philippine time/);
  assert.match(summary,/Role: Manager/);assert.match(summary,/Approve or reject refunds/);assert.doesNotMatch(summary,/is_active|refund_approval|\{/);
  assert.equal(auditAction("Created payment_accounts record"),"Created a receiving account");
  assert.match(auditSummary(null,new Map(),"unknown"),/No additional details/);
  assert.equal(auditSummary({constructor:"An unfamiliar field",newStatus:"confirmed"},new Map(),"reservation"),"Constructor: An unfamiliar field\nNew status: Confirmed");
  assert.equal(auditSummary({reason:"staff",note:"edit_reservation"},new Map(),"reservation"),"Reason: staff\nNote: edit_reservation");
});

test("audit API resolves nested item names, actors, booking references and keeps original evidence",async()=>{
  const details={before:{adult_count:20},after:{adultCount:22,services:[{serviceId:id(4),quantity:2}]},before_services:[{service_id:id(4),quantity:1}],reason:"Guest requested extra bedding"};
  const db=dashboardDatabase({audit_logs:[{log_id:id(9),user_id:id(1),action:"Edited reservation and bill",entity_type:"reservation",entity_id:id(2),details,created_at:"2026-11-13T00:00:00Z"},
    {log_id:id(10),auth_user_id:id(7),action:"Refund payout_submitted",entity_type:"refund_request",entity_id:id(6),details:{amount:1000,old_status:"approved",new_status:"payout_submitted"},created_at:"2026-11-13T01:00:00Z"}],
    staff_users:[{id:id(1),full_name:"Maria Santos"}],guests:[{id:id(7),first_name:"Juan",middle_name:"Reyes",last_name:"Cruz"}],
    reservations:[{reservation_id:id(2),reference_number:"MV-2026-001"}],services:[{service_id:id(4),name:"Extra mattress"}],refund_requests:[{refund_id:id(6),reservation_id:id(2)}]});
  const {GET}=loadTsModule("app/api/admin/audit/route.ts",{"@/lib/server/admin-audit":{requireActiveStaff:async()=>({supabase:db.client})},"@/lib/supabase/admin":{tryCreateAdminClient:()=>null}});
  const response=await GET(new Request("http://localhost/api/admin/audit?period=custom&startDate=2026-11-13&endDate=2026-11-13"));
  assert.equal(response.status,200);const {rows}=await response.json(),edit=rows.find(row=>row.id===id(9));
  assert.equal(edit.staff,"Maria Santos");assert.equal(edit.module,"Reservations");assert.equal(edit.record,"Reservation MV-2026-001");
  assert.match(edit.summary,/Adults: 20 → 22/);assert.match(edit.summary,/Extra mattress × 1 → Extra mattress × 2/);assert.deepEqual(JSON.parse(edit.details),details);
  const payout=rows.find(row=>row.id===id(10));assert.equal(payout.record,"Refund for Reservation MV-2026-001");assert.equal(payout.staff,"Juan Reyes Cruz");
  assert.match(payout.action,/manager verification/);assert.equal(payout.originalAction,"Refund payout_submitted");
});
test("missing or deleted record names do not invent details or prevent reading audit history",async()=>{
  const db=dashboardDatabase({audit_logs:[{log_id:id(1),action:"Archived services record",entity_type:"services",entity_id:id(99),details:null,created_at:"2026-11-13T00:00:00Z"}]});
  const {GET}=loadTsModule("app/api/admin/audit/route.ts",{"@/lib/server/admin-audit":{requireActiveStaff:async()=>({supabase:db.client})},"@/lib/supabase/admin":{tryCreateAdminClient:()=>null}});
  const response=await GET(new Request("http://localhost/api/admin/audit"));assert.equal(response.status,200);
  const row=(await response.json()).rows[0];assert.match(row.record,/unavailable/);assert.doesNotMatch(row.record,/11111111/);assert.equal(row.recordId,id(99));assert.match(row.summary,/No additional details/);
});
