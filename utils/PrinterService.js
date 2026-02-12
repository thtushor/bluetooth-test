
// ESC/POS Commands
const ESC = 0x1B;
const GS = 0x1D;
const LF = 0x0A;

export const PrinterCommands = {
    INIT: [ESC, 0x40], // Initialize printer
    ALIGN_LEFT: [ESC, 0x61, 0x00],
    ALIGN_CENTER: [ESC, 0x61, 0x01],
    ALIGN_RIGHT: [ESC, 0x61, 0x02],
    BOLD_ON: [ESC, 0x45, 0x01],
    BOLD_OFF: [ESC, 0x45, 0x00],
    TEXT_NORMAL: [GS, 0x21, 0x00],
    TEXT_DOUBLE_HEIGHT: [GS, 0x21, 0x10],
    TEXT_DOUBLE_WIDTH: [GS, 0x21, 0x20],
    TEXT_DOUBLE_SIZE: [GS, 0x21, 0x30],
    CUT: [GS, 0x56, 0x41, 0x10], // Cut paper
    FEED_LINES: (n) => [ESC, 0x64, n],
};

// Helper to convert string to byte array (ASCII/UTF-8 for basic receipt printers often just ASCII)
function stringToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        // Simple ASCII mapping, ignoring high-bit characters which might need specific codepage handling
        if (code > 0xFF) code = 0x3F; // '?' for unknown
        bytes.push(code);
    }
    return bytes;
}

// Helper to format currency
function formatCurrency(amount) {
    return parseFloat(amount).toFixed(2);
}

function formatDate(date) {
    const d = new Date(date);
    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Utility to create command buffer
class CommandBuilder {
    constructor() {
        this.buffer = [];
    }

    add(startCommands) {
        if (Array.isArray(startCommands)) {
            this.buffer.push(...startCommands);
        } else {
            this.buffer.push(startCommands);
        }
        return this;
    }

    text(str) {
        this.buffer.push(...stringToBytes(str));
        return this;
    }

    textLine(str) {
        this.text(str);
        this.buffer.push(LF);
        return this;
    }

    newLine() {
        this.buffer.push(LF);
        return this;
    }

    getData() {
        return this.buffer;
    }
}

export const generateInvoiceCommands = (data) => {
    const builder = new CommandBuilder();
    builder.add(PrinterCommands.INIT);
    builder.add(PrinterCommands.ALIGN_CENTER);

    // Header: Restaurant name, location, tel
    if (data.businessInfo?.name) {
        builder.add(PrinterCommands.BOLD_ON);
        builder.textLine(data.businessInfo.name);
        builder.add(PrinterCommands.TEXT_NORMAL);
        builder.add(PrinterCommands.BOLD_OFF);
    }

    if (data.businessInfo?.address) {
        builder.textLine(data.businessInfo.address);
    }
    if (data.businessInfo?.phone) {
        builder.textLine(`Tel: ${data.businessInfo.phone}`);
    }

    builder.textLine("-".repeat(32));

    // Invoice Details Section (Left Aligned)
    builder.add(PrinterCommands.ALIGN_LEFT);
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine("Invoice:");
    builder.add(PrinterCommands.BOLD_OFF);

    builder.textLine(`Invoice    : ${data.invoiceNumber || 'N/A'}`);
    builder.textLine(`Date       : ${formatDate(data.date)}`);

    if (data.tableNumber) {
        builder.textLine(`Table      : ${data.tableNumber}`);
    }
    if (data.guestNumber) {
        builder.textLine(`Guests     : ${data.guestNumber}`);
    }

    builder.textLine(`Customer   : ${data.customer?.name || 'Walk-in Customer'}`);

    if (data.customer?.phone) {
        builder.textLine(`Phone      : ${data.customer.phone}`);
    }

    builder.textLine("-".repeat(32));

    // Items Header
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine("QTY ITEM                   TOTAL");
    builder.add(PrinterCommands.BOLD_OFF);

    // Items
    if (data.items) {
        data.items.forEach(item => {
            const qty = `${item.quantity}x`;
            const name = item.productName.substring(0, 18);
            const total = formatCurrency(item.subtotal);

            // 32 chars width: Qty(4) + Name(18) + Total(10)
            const line = `${qty.padEnd(4, ' ')}${name.padEnd(18, ' ')}${total.padStart(10, ' ')}`;
            builder.textLine(line);

            // Details on next line (category, etc.)
            if (item.details) {
                builder.textLine(`    - ${item.details}`);
            }
        });
    }

    builder.textLine("-".repeat(32));

    // Summary Section (Right Aligned)
    builder.add(PrinterCommands.ALIGN_LEFT);

    // Subtotal
    const subtotal = data.summary?.subtotal || 0;
    builder.textLine(`SUBTOTAL${formatCurrency(subtotal).padStart(24, ' ')}`);

    // Discount (if applicable)
    if (data.summary?.discount && parseFloat(data.summary.discount) > 0) {
        const discountRate = data.summary?.discountRate || '0';
        const discountAmount = data.summary?.discount || 0;
        const label = `Discount (${discountRate})`;
        const value = `-${formatCurrency(discountAmount)}`;
        builder.textLine(`${label.padEnd(22, ' ')}${value.padStart(10, ' ')}`);
    }

    // VAT/Tax
    if (data.summary?.tax && parseFloat(data.summary.tax) > 0) {
        const taxRate = data.summary?.taxRate || '0';
        const label = `Vat (${taxRate})`;
        const value = formatCurrency(data.summary.tax);
        builder.textLine(`${label.padEnd(22, ' ')}${value.padStart(10, ' ')}`);
    }

    builder.textLine("-".repeat(32));

    // Total
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine(`TOTAL${formatCurrency(data.summary?.total || 0).padStart(27, ' ')}`);
    builder.add(PrinterCommands.BOLD_OFF);

    builder.add(PrinterCommands.ALIGN_CENTER);
    builder.newLine();
    builder.textLine("Thank You!");
    builder.add(PrinterCommands.FEED_LINES(3));
    builder.add(PrinterCommands.CUT);

    return builder.getData();
};

export const generateKOTCommands = (data) => {
    const builder = new CommandBuilder();
    builder.add(PrinterCommands.INIT);
    builder.add(PrinterCommands.ALIGN_CENTER);

    // Restaurant name
    if (data.businessInfo?.name) {
        builder.add(PrinterCommands.BOLD_ON);
        builder.textLine(data.businessInfo.name);
        builder.add(PrinterCommands.BOLD_OFF);
    }

    // "KITCHEN ORDER TICKET (KOT)" header
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine("KITCHEN ORDER TICKET (KOT)");
    builder.add(PrinterCommands.BOLD_OFF);

    // DATE
    builder.textLine(new Date(data.date).toLocaleString());

    builder.textLine("-".repeat(32));

    // Table and Guests (Left Aligned)
    builder.add(PrinterCommands.ALIGN_LEFT);

    if (data.tableNumber) {
        builder.textLine(`Table No   : ${data.tableNumber}`);
    }
    if (data.guestNumber) {
        builder.textLine(`Guests     : ${data.guestNumber}`);
    }

    builder.textLine("-".repeat(32));

    // Items Header
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine("QTY  ITEM");
    builder.add(PrinterCommands.BOLD_OFF);

    // Items List
    if (data.items) {
        data.items.forEach(item => {
            const qty = `${item.quantity}x`;
            builder.textLine(`${qty.padEnd(5, ' ')}${item.productName}`);

            // Details/category on next line with "-" prefix
            if (item.details) {
                builder.textLine(`-    ${item.details}`);
            }
        });
    }

    builder.textLine("-".repeat(32));

    // Total Items count
    const totalItems = data.items ? data.items.reduce((sum, item) => sum + item.quantity, 0) : 0;
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine(`TOTAL ITEMS:${String(totalItems).padStart(20, ' ')}`);
    builder.add(PrinterCommands.BOLD_OFF);

    builder.add(PrinterCommands.FEED_LINES(3));
    builder.add(PrinterCommands.CUT);
    return builder.getData();
};

export const generateBarcodeCommands = (data) => {
    const builder = new CommandBuilder();
    builder.add(PrinterCommands.INIT);
    builder.add(PrinterCommands.ALIGN_CENTER);

    // Header (Brand/Category)
    const header = [data.brandName, data.categoryName].filter(Boolean).join(' / ');
    if (header) builder.textLine(header.substring(0, 32));

    // Shop Name
    if (data.shopName) {
        builder.add(PrinterCommands.BOLD_ON);
        builder.textLine(data.shopName);
        builder.add(PrinterCommands.BOLD_OFF);
    }

    // Barcode (Code128 using GS k)
    // GS k m n d1...dk
    // m=73 (Code128)
    if (data.sku) {
        builder.newLine();
        // ESC/POS Barcode commands
        builder.add([GS, 0x68, 80]); // Set height to 80
        builder.add([GS, 0x77, 2]);  // Set width to 2
        builder.add([GS, 0x48, 2]);  // HRI position: Below

        // Code128 (Function B) using GS k 73
        // Syntax: GS k 73 <length> <data>
        // Data must usually start with a code set selection. 
        // {B (0x7B, 0x42) selects Code Set B (alphanumeric).
        const codeSetB = [0x7B, 0x42];
        const skuBytes = stringToBytes(data.sku);
        const barcodeData = [...codeSetB, ...skuBytes];

        builder.add([GS, 0x6B, 73, barcodeData.length]);
        builder.add(barcodeData);

        builder.newLine();
    }

    if (data.price) {
        builder.add(PrinterCommands.BOLD_ON);
        builder.textLine(`Price: ${formatCurrency(data.price)}`);
        builder.add(PrinterCommands.BOLD_OFF);
    }

    builder.add(PrinterCommands.FEED_LINES(3));
    // builder.add(PrinterCommands.CUT); // Barcodes often peel-off, may not need cut
    return builder.getData();
};

export const generateTSPLCommands = (data) => {
    // TSPL Commands for 35x18mm Label (Standard)
    // Adaptive size if provided in data.labelSize
    const width = data.labelSize?.widthMm || 35;
    const height = data.labelSize?.heightMm || 18;

    let commands = `SIZE ${width} mm, ${height} mm\r\n`;
    commands += `GAP 2 mm, 0\r\n`;
    commands += `DIRECTION 1\r\n`;
    commands += `CLS\r\n`;

    const topText = [data.brandName, data.categoryName, data.modelNo].filter(Boolean).join(' / ');
    // Text coordinates approximated from 203 DPI (8 dots/mm)
    // 140 dots ~ 17.5mm (center of 35mm? No, 35mm * 8 = 280 dots. Center is 140. Correct.)

    // TEXT x,y,"font",rotation,x-mul,y-mul,alignment,"content"
    // alignment 2 = center? In original it was 3? TSPL docs say 1=left, 2=center, 3=right.
    // Original: TEXT 140,15,"0",0,1,1,3,"content". 3 might be center-anchor in some firmwares or Readme specific. 
    // Let's stick to original logic: 3.

    commands += `TEXT 140,15,"0",0,1,1,3,"${topText.substring(0, 25)}"\r\n`;
    commands += `TEXT 140,40,"0",0,1,1,3,"SHOP: ${data.shopName || ''}"\r\n`;

    // BARCODE x,y,"type",height,human_readable,rotation,narrow,wide,"content"
    // Original: BARCODE 40,70,"128",50,1,0,2,2,"${sku}"
    // X=40 (leftish). 
    commands += `BARCODE 40,70,"128",50,1,0,2,2,"${data.sku}"\r\n`;

    commands += `PRINT 1\r\n`;

    return stringToBytes(commands); // TSPL is just text bytes
};


// Main Helper
export const formatDataForPrinter = (type, data) => {
    switch (type) {
        case 'INVOICE':
            return generateInvoiceCommands(data);
        case 'KOT':
            return generateKOTCommands(data);
        case 'BARCODE':
            // ESC/POS
            return generateBarcodeCommands(data);
        case 'BARCODE_LABEL':
            // TSPL
            return generateTSPLCommands(data);
        default:
            return [];
    }
};
