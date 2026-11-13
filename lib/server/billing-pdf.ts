import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BillingBreakdown } from "@/lib/booking/billing-breakdown";

export type BillingPdfInput = {
  kind: "receipt" | "invoice"; documentNumber: string; issuedAt: string; updatedAt?: string;
  guestName: string; reservationReference: string; checkInDate: string; checkOutDate: string;
  bookingMode: string; adultCount: number; childCount: number; breakdown: BillingBreakdown;
  totalAmount: number; paidAmount: number; balance: number; paymentMethod?: string; paymentReference?: string; paidAt?: string | null;
};
const money = (value: number) => `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
};

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ""; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Generate a real, selectable-text A4 document from the issued billing values. */
export async function createBillingPdf(input: BillingPdfInput, logo?: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile(join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf")), { subset: true });
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const title = input.kind === "receipt" ? "Payment Receipt" : input.updatedAt ? "Updated Billing Statement" : "Reservation Invoice";
  pdf.setTitle(`${title} - ${input.documentNumber}`);
  pdf.setSubject(`Reservation ${input.reservationReference} | Guest ${input.guestName}`);
  pdf.setAuthor("MarVille Resort Complex"); pdf.setCreator("MarVille Resort Complex");
  const ink = rgb(.23,.16,.12), terracotta = rgb(.66,.27,.17), cream = rgb(.973,.957,.925), green = rgb(.18,.42,.25);
  const width = 595.28, height = 841.89, margin = 42, contentWidth = width - margin * 2;
  const mark = logo ? await pdf.embedPng(logo).catch(() => null) : null;
  let page!: PDFPage;
  let y = 0;
  const startPage = () => {
    page = pdf.addPage([width,height]);
    page.drawRectangle({x:0,y:height-8,width,height:8,color:terracotta});
    page.drawText("MARVILLE RESORT COMPLEX",{x:margin,y:height-44,font:bold,size:14,color:terracotta});
    page.drawText("Where the Sun Never Sets",{x:margin,y:height-62,font,size:9,color:ink});
    if(mark){const dimensions=mark.scaleToFit(112,42);page.drawImage(mark,{x:width-margin-dimensions.width,y:height-70,width:dimensions.width,height:dimensions.height});}
    page.drawText(title,{x:margin,y:height-102,font:bold,size:23,color:ink});
    y=height-128;
  };
  const ensure = (space: number) => { if(y-space<64) startPage(); };
  const paragraph = (text: string, size=10, color=ink) => {
    for(const line of wrap(text,font,size,contentWidth)){ensure(size+7);page.drawText(line,{x:margin,y,font,size,color});y-=size+6;}
    y-=5;
  };
  const row = (label: string,value: string,highlight=false) => {
    const values=wrap(value,font,10,contentWidth-174);
    const rowHeight=Math.max(30,values.length*15+14);ensure(rowHeight);
    page.drawRectangle({x:margin,y:y-rowHeight+8,width:contentWidth,height:rowHeight,color:highlight?rgb(.93,.96,.93):cream});
    page.drawText(label,{x:margin+12,y:y-10,font:bold,size:9,color:highlight?green:ink});
    values.forEach((line,index)=>page.drawText(line,{x:margin+170,y:y-10-index*15,font,size:10,color:highlight?green:ink}));
    y-=rowHeight;
  };
  startPage();
  row(input.kind==="receipt"?"Receipt number":input.updatedAt?"Statement reference":"Invoice ID",input.documentNumber);
  row("Issued",date(input.issuedAt));row("Guest",input.guestName);
  if(input.updatedAt)row("Statement updated",date(input.updatedAt));
  row("Booking reference",input.reservationReference);row("Payment for",input.bookingMode);
  row("Guests",`${input.adultCount} adults, ${input.childCount} children`);
  row("Check-in (Philippine time)",date(input.checkInDate));row("Check-out (Philippine time)",date(input.checkOutDate));
  if(input.kind==="receipt" || input.paymentMethod)row("Payment method",input.paymentMethod || "Not recorded");
  if(input.kind==="receipt" || input.paymentReference)row("Payment reference",input.paymentReference || "Not recorded");
  if(input.kind==="receipt")row("Paid at (Philippine time)",input.paidAt ? date(input.paidAt) : "Not recorded");
  y-=22;ensure(55);paragraph("ITEMS AND CHARGES",11,terracotta);
  for(const item of input.breakdown.lines){
    // Keep the heading and amount together; long descriptions can continue on
    // later pages without clipping text or splitting an amount across pages.
    const heading=wrap(item.description,font,11,contentWidth-130);ensure(48);
    const amount=money(item.amount);
    page.drawText(amount,{x:width-margin-font.widthOfTextAtSize(amount,10),y,font,size:10,color:ink});
    for(const line of heading){ensure(18);page.drawText(line,{x:margin,y,font,size:11,color:ink});y-=17;}
    paragraph(item.detail,9);
    paragraph(`Quantity: ${item.quantity}  |  Rate: ${money(item.unitPrice)}`,9);
    y-=7;
  }
  ensure(145);row("Total charges",money(input.totalAmount));
  row(input.kind==="receipt"?"This payment received":"Payments received",money(input.paidAmount));
  row("Remaining balance",money(input.balance),true);
  y-=22;paragraph("Keep this document for your records. For assistance, call 09172796592 or 82360633.",9);
  const pages=pdf.getPages();pages.forEach((sheet,index)=>{
    sheet.drawLine({start:{x:margin,y:45},end:{x:width-margin,y:45},thickness:.5,color:rgb(.85,.81,.76)});
    sheet.drawText(`MarVille Resort Complex | Taytay, Rizal | ${index+1} / ${pages.length}`,{x:margin,y:29,font,size:8,color:ink});
  });
  return Buffer.from(await pdf.save());
}

export const billingPdfFilename = (kind: "receipt" | "invoice", reference: string) =>
  `${kind}-${reference.replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,100) || "document"}.pdf`;
