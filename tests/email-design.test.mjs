import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { PDFDocument } from "pdf-lib";

const messages = [];
const previous = Object.fromEntries(["EMAIL_USER","EMAIL_PASS","EMAIL_APP_NAME"].map(key => [key,process.env[key]]));
let mail;
before(() => {
  Object.assign(process.env,{EMAIL_USER:"mailer@example.com",EMAIL_PASS:"fixture-only",EMAIL_APP_NAME:"MarVille Resort Complex"});
  mail=loadTsModule("lib/email.ts",{nodemailer:{createTransport:()=>({sendMail:async message=>{messages.push(message);return {accepted:[message.to]};}})}});
});
after(() => { for(const [key,value] of Object.entries(previous)) if(value===undefined)delete process.env[key];else process.env[key]=value; });
const base={guestEmail:"guest@example.com",guestName:"Maria & Juan <Guest>",reservationReference:"MV-TEST-123",checkInDate:"2027-01-15T04:30:00Z",checkOutDate:"2027-01-15T08:00:00Z"};
const visit={...base,referenceNumber:"OC-TEST-123",scheduledDate:"2027-01-15",timeSlot:"08:00-09:00",cancellationReason:"Guest requested a different date."};
const billing={...base,bookingMode:"day",adultCount:12,childCount:3,issuedAt:"2027-01-14T10:00:00Z",paidAt:"2027-01-13T16:10:00Z",paymentMethod:"Bank & Wallet",paymentReference:"PAY-123<456>",receiptNumber:"RCP-TEST-123",amountPaid:2500,paidAmount:2500,totalAmount:10000,balance:7500,
  breakdown:{total:10000,lines:[{description:"Private pool & rooms",detail:"Package includes two rooms <included>",quantity:1,unitPrice:9500,amount:9500},{description:"Extra mattress",detail:"Additional service",quantity:2,unitPrice:250,amount:500}]}};

test("every guest email uses the shared themed frame and preserves escaped recipient details",async()=>{
  const cases=[
    ["sendGuestConfirmationEmail",{email:base.guestEmail,guestName:base.guestName,confirmationUrl:"https://resort.example/auth/confirm?token_hash=sample&type=email"},"Confirm your email"],
    ["sendPaymentReceiptEmail",billing,"Payment Receipt"],
    ["sendReservationInvoiceEmail",billing,"Reservation Invoice"],
    ["sendReservationConfirmedEmail",base,"Reservation Confirmed"],
    ["sendReservationCancelledEmail",{...base,cancellationReason:"Guest requested cancellation <details>",refundSummary:"Pending refund review."},"Reservation Cancelled"],
    ["sendRefundStatusEmail",{...base,amount:2500,status:"refunded",notes:"Transfer verified & completed."},"Refund update"],
    ["sendOcularVisitScheduledEmail",visit,"Ocular Visit Scheduled"],
    ["sendOcularVisitApprovedEmail",visit,"Ocular Visit Approved"],
    ["sendOcularVisitReviewedEmail",{...visit,approved:false,reason:"Unavailable <details>"},"Ocular Visit Rejected"],
    ["sendOcularVisitCancelledEmail",visit,"Ocular Visit Cancelled"],
  ];
  for(const [fn,payload,title] of cases){
    assert.equal(await mail[fn](payload),true);
    const message=messages.at(-1),dom=new JSDOM(message.html),doc=dom.window.document;
    try{
      assert.match(message.html,/^<!doctype html>/i);
      assert.equal(doc.documentElement.lang,"en");
      assert.ok(doc.querySelector('meta[name="viewport"]'));
      assert.equal(doc.querySelector("h2").textContent.trim(),title);
      assert.equal(doc.querySelectorAll("script").length,0);
      assert.match(doc.body.textContent,/Maria & Juan <Guest>/);
      assert.match(doc.body.textContent,/MarVille Resort Complex/);
      assert.ok(doc.querySelector('td[bgcolor="#A9442B"]'));
      assert.ok(doc.querySelector('a[href="tel:+639172796592"]'));
      assert.match(message.text,/Maria & Juan <Guest>/);
      assert.equal(message.to,base.guestEmail);
      const attachments=message.attachments.filter(file=>file.contentType==="application/pdf");
      if(fn==="sendPaymentReceiptEmail"||fn==="sendReservationInvoiceEmail"){
        assert.equal(attachments.length,1);assert.equal(attachments[0].contentDisposition,"attachment");
        assert.match(attachments[0].filename,/\.pdf$/);assert.ok((await PDFDocument.load(attachments[0].content)).getPageCount()>0);
      }else assert.equal(attachments.length,0);
    }finally{dom.window.close();}
  }
});

test("confirmation links remain intact and billing documents retain dates, prices, quantities and balances",async()=>{
  const url="https://resort.example/auth/confirm?token_hash=sample&type=email";
  await mail.sendGuestConfirmationEmail({email:base.guestEmail,guestName:base.guestName,confirmationUrl:url});
  const dom=new JSDOM(messages.at(-1).html);
  try{
    const links=[...dom.window.document.querySelectorAll("a")].filter(link=>link.textContent.includes("Confirm email")||link.textContent.includes("token_hash"));
    assert.equal(links.length,2);assert.ok(links.every(link=>link.href===url));
    assert.ok(messages.at(-1).text.includes(url));
  }finally{dom.window.close();}
  await mail.sendPaymentReceiptEmail(billing);
  const doc=new JSDOM(messages.at(-1).html);
  try{
    const text=doc.window.document.body.textContent;
    for(const expected of ["MV-TEST-123","RCP-TEST-123","Private pool & rooms","Package includes two rooms <included>","Qty: 2","250.00","500.00","10,000.00","7,500.00","12:30","4:00"])
      assert.ok(text.includes(expected),`missing billing detail: ${expected}`);
    assert.equal(doc.window.document.querySelector("thead tr").children.length,2,"compact billing table keeps amounts readable on phones");
    for(const expected of ["Payment method","Bank & Wallet","Payment reference","PAY-123<456>","Paid at (Philippine time)","12:10"]){
      assert.ok(text.includes(expected),`missing receipt detail: ${expected}`);assert.ok(messages.at(-1).text.includes(expected));
    }
    assert.match(messages.at(-1).html,/PAY-123&lt;456&gt;/);
  }finally{doc.window.close();}
});

test("updated statements have a distinct subject, heading and update timestamp with current balances",async()=>{
  await mail.sendReservationInvoiceEmail({...billing,updatedAt:"2027-01-15T16:15:00Z"});
  const message=messages.at(-1),dom=new JSDOM(message.html);
  try{
    assert.match(message.subject,/Updated Billing Statement MV-TEST-123/);
    assert.equal(dom.window.document.querySelector("h2").textContent,"Updated Billing Statement");
    for(const expected of ["Statement updated","January 16, 2027","12:15","Payments received","7,500.00"]){
      assert.ok(message.text.includes(expected),`missing updated statement detail: ${expected}`);assert.ok(dom.window.document.body.textContent.includes(expected));
    }
    assert.equal(message.attachments.filter(file=>file.contentType==="application/pdf").length,1);
  }finally{dom.window.close();}
});

test("legacy receipts explicitly label missing payment metadata without inventing a paid-at timestamp",async()=>{
  await mail.sendPaymentReceiptEmail({...billing,paymentMethod:undefined,paymentReference:undefined,paidAt:null});
  const message=messages.at(-1);assert.match(message.text,/Payment method: Not recorded/);assert.match(message.text,/Payment reference: Not recorded/);assert.match(message.text,/Paid at \(Philippine time\): Not recorded/);
});
