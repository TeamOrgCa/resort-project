import sharp from "sharp";

// A synthetic Send Money layout: masked recipient, graphic success, two-column footer.
export async function sendMoneyReceiptImage({ marker = "check", phone = "+63 9** *** 5095", date = "Oct 13, 2026 6:22 PM", reference = "6046080000001" } = {}) {
  const symbol = marker === "check" ? '<path d="M 398 94 L 411 106 L 433 84" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    : marker === "cross" ? '<path d="M 401 84 L 431 108 M 401 108 L 431 84" stroke="white" stroke-width="5"/>'
    : marker === "v" ? '<path d="M 398 84 L 416 108 L 434 84" stroke="white" fill="none" stroke-width="5"/>' : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="828" height="1608">
    <rect width="828" height="1608" fill="#0759da"/>
    <rect x="48" y="96" width="732" height="1120" rx="10" fill="white"/>
    <circle cx="416" cy="96" r="46" fill="#0856b5" stroke="white" stroke-width="6"/>${symbol}
    <g font-family="Arial" fill="#143450">
      <text x="290" y="220" font-size="42">A*****B C.</text>
      <text x="280" y="279" font-size="33">${phone}</text>
      <text x="316" y="350" font-size="27" fill="#777777">Sent via GCash</text>
      <path d="M 80 426 H 748 M 80 572 H 748" stroke="#999999"/>
      <text x="80" y="510" font-size="32">Amount</text><text x="653" y="510" font-size="30">100.00</text>
      <text x="80" y="665" font-size="32">Total Amount Sent</text><text x="560" y="675" font-size="48">PHP100.00</text>
      <text x="80" y="784" font-size="24">Ref No. ${reference}</text><text x="520" y="791" font-size="23">${date}</text>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Reproduce the supplied Android layout with synthetic account/reference values.
export async function androidSendMoneyReceiptImage({ date, amount = "200.00", phone = "+63 917 123 5095", reference = "0046 080 000001" } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1741">
    <rect width="720" height="1741" fill="#1000ff"/>
    <rect x="34" y="113" width="652" height="1310" rx="28" fill="white"/>
    <path d="M 34 652 H 686 V 1423 H 34 Z" fill="#f4f8ff"/>
    <circle cx="360" cy="109" r="42" fill="#0856b5" stroke="white" stroke-width="5"/>
    <path d="M 343 110 L 354 121 L 378 99" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <g font-family="Arial" fill="#143450">
      <text x="188" y="248" font-size="39">A••B C•••••D E.</text>
      <rect x="217" y="281" width="306" height="58" rx="29" fill="#edf2fa"/>
      <text x="237" y="321" font-size="32">${phone}</text>
      <text x="270" y="374" font-size="25" fill="#777777">Sent via GCash</text>
      <path d="M 72 421 H 648 M 72 521 H 648" stroke="#999999"/>
      <text x="72" y="481" font-size="30">Amount</text><text x="555" y="481" font-size="30">${amount}</text>
      <text x="72" y="597" font-size="30">Total Amount Sent</text><text x="460" y="604" font-size="48">₱${amount}</text>
      <text x="72" y="716" font-size="24">Ref No. ${reference}</text><text x="430" y="716" font-size="22">${date}</text>
      <rect x="72" y="1192" width="576" height="174" rx="10" fill="#9ae6c8"/>
      <text x="110" y="1258" font-size="30" fill="#126946">279g (gCO2e)</text>
      <text x="107" y="1305" font-size="21" fill="#126946">By going digital, you reduce your carbon footprint from</text>
      <text x="107" y="1338" font-size="21" fill="#126946">transportation, paper, and plastic.</text>
    </g>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
