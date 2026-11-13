import test from "node:test";
import assert from "node:assert/strict";
import {loadTsModule} from "./helpers/load-ts-module.mjs";

const {parseServiceSelections,serviceQuantityError,serviceQuantityLimit}=loadTsModule("lib/booking/service-quantity.ts");
const catalog=[{service_id:"mattress",name:"Mattress",max_quantity:3}];

test("service selections reject invalid and duplicate quantities instead of silently changing them to one",()=>{
  assert.deepEqual(parseServiceSelections(undefined),[]);
  assert.deepEqual(parseServiceSelections([{serviceId:"Mattress"}]),[{serviceId:"mattress",quantity:1}]);
  for(const quantity of [null,0,-1,1.5,"2",10001,Infinity])assert.equal(parseServiceSelections([{serviceId:"mattress",quantity}]),null);
  for(const input of [null,{},[null],[{serviceId:""}],[{serviceId:"mattress"},{serviceId:"MATTRESS"}],Array(101).fill({serviceId:"mattress"})])assert.equal(parseServiceSelections(input),null);
});

test("per-booking limits allow exact caps and retain existing quantities above a subsequently lowered cap",()=>{
  assert.equal(serviceQuantityError([{serviceId:"mattress",quantity:3}],catalog),null);
  assert.match(serviceQuantityError([{serviceId:"mattress",quantity:4}],catalog),/Mattress.*maximum quantity of 3/);
  const existing=[{service_id:"mattress",quantity:5}];
  for(const quantity of [1,3,5])assert.equal(serviceQuantityError([{serviceId:"mattress",quantity}],catalog,existing),null);
  assert.match(serviceQuantityError([{serviceId:"mattress",quantity:6}],catalog,existing),/maximum quantity of 5/);
  assert.equal(serviceQuantityLimit(undefined),10000);assert.equal(serviceQuantityLimit(2,5),5);
  assert.equal(serviceQuantityError([{serviceId:"mattress",quantity:5}],[],existing),null);
  assert.match(serviceQuantityError([{serviceId:"mattress",quantity:6}],[],existing),/no longer available/);
});

test("booking summaries multiply services by quantities and retain old draft quantities of one",()=>{
  const {buildBookingCostSummary}=loadTsModule("lib/booking/summary.ts");
  const summary=buildBookingCostSummary({total:9000,tax:0,roomPrice:7500,services:[{id:"mattress",price:500,quantity:3}]});
  assert.equal(summary.servicesTotal,1500);assert.equal(summary.packageCharge,7500);
  const legacy=buildBookingCostSummary({total:8000,tax:0,roomPrice:7500,services:[{id:"mattress",price:500}]});assert.equal(legacy.servicesTotal,500);
});
