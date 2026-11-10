import test from "node:test";
import assert from "node:assert/strict";
import * as pdfLib from "pdf-lib";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const base={kind:"receipt",documentNumber:"RCP-TEST-123",issuedAt:"2027-01-14T10:00:00Z",guestName:"José Muñoz",reservationReference:"MV-TEST-123",checkInDate:"2027-01-15T04:30:00Z",checkOutDate:"2027-01-15T08:00:00Z",bookingMode:"Day swimming",adultCount:12,childCount:3,totalAmount:10000,paidAmount:2500,balance:7500,paymentMethod:"Cash",paymentReference:"CASH-12345678",breakdown:{total:10000,lines:[{description:"Private pool package",detail:"Private rooms and standard inclusions",quantity:1,unitPrice:10000,amount:10000}]}};

test("receipt PDFs preserve actual references, Philippine times, accented guest names and money",async()=>{
  const drawn=[];
  const {createBillingPdf,billingPdfFilename}=loadTsModule("lib/server/billing-pdf.ts",{"pdf-lib":{...pdfLib,PDFDocument:{create:async()=>{
    const doc=await pdfLib.PDFDocument.create(),addPage=doc.addPage.bind(doc);
    doc.addPage=(...args)=>{const page=addPage(...args),draw=page.drawText.bind(page);page.drawText=(text,options)=>{drawn.push({text,...options});return draw(text,options);};return page;};return doc;
  }}}});
  const bytes=await createBillingPdf(base),pdf=await pdfLib.PDFDocument.load(bytes);
  assert.equal(bytes.subarray(0,5).toString(),"%PDF-");assert.match(pdf.getTitle(),/RCP-TEST-123/);
  for(const value of ["José Muñoz","MV-TEST-123","Cash","CASH-12345678","PHP 2,500.00","PHP 7,500.00"])
    assert.ok(drawn.some(line=>line.text.includes(value)),`PDF is missing ${value}`);
  assert.ok(drawn.some(line=>/12:30/.test(line.text)));assert.ok(drawn.some(line=>/4:00/.test(line.text)));
  assert.equal(billingPdfFilename("receipt","../RCP/123\r\n"),"receipt----RCP-123--.pdf");
});

test("long invoices paginate and keep all line text within the printable page",async()=>{
  const drawn=[];
  const {createBillingPdf}=loadTsModule("lib/server/billing-pdf.ts",{"pdf-lib":{...pdfLib,PDFDocument:{create:async()=>{
    const doc=await pdfLib.PDFDocument.create(),add=doc.addPage.bind(doc);
    doc.addPage=(...args)=>{const page=add(...args),draw=page.drawText.bind(page);page.drawText=(text,options)=>{drawn.push({text,...options});return draw(text,options);};return page;};return doc;
  }}}});
  const lines=Array.from({length:80},(_,index)=>({description:`Additional service ${index+1}`,detail:"Long description ".repeat(15)+(index===0?"A".repeat(300):""),quantity:2,unitPrice:125,amount:250}));
  const bytes=await createBillingPdf({...base,kind:"invoice",documentNumber:"invoice-id",breakdown:{lines,total:20000},totalAmount:20000,paidAmount:20000,balance:0});
  const pdf=await pdfLib.PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>2);
  assert.ok(drawn.some(line=>line.text==="Additional service 80"));assert.ok(drawn.some(line=>line.text==="PHP 0.00"));
  for(const line of drawn){assert.ok(line.y>=29&&line.y<842);assert.ok(line.x+line.font.widthOfTextAtSize(line.text,line.size)<=554,`Text overflows: ${line.text}`);}
});
