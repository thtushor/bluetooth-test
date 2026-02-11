
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

    if (data.businessInfo?.name) {
        builder.add(PrinterCommands.BOLD_ON);
        builder.add(PrinterCommands.TEXT_DOUBLE_SIZE);
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
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine("INVOICE");
    builder.add(PrinterCommands.BOLD_OFF);
    builder.add(PrinterCommands.ALIGN_LEFT);

    builder.textLine(`Inv #: ${data.invoiceNumber || 'N/A'}`);
    builder.textLine(`Date: ${new Date(data.date).toLocaleString()}`);

    if (data.tableNumber) builder.textLine(`Table: ${data.tableNumber}`);
    if (data.customer?.name) builder.textLine(`Cust: ${data.customer.name}`);

    builder.textLine("-".repeat(32));
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine("Item            Qty    Total");
    builder.add(PrinterCommands.BOLD_OFF);
    builder.textLine("-".repeat(32));

    // Items
    if (data.items) {
        data.items.forEach(item => {
            const name = item.productName.substring(0, 16).padEnd(16, ' ');
            const qty = String(item.quantity).padStart(3, ' ');
            const total = formatCurrency(item.subtotal).padStart(10, ' '); // Adjusted padding
            builder.textLine(`${name} ${qty} ${total}`);
            if (item.details) {
                builder.textLine(`  ${item.details}`);
            }
        });
    }

    builder.textLine("-".repeat(32));
    builder.add(PrinterCommands.ALIGN_RIGHT);
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine(`TOTAL: ${formatCurrency(data.summary?.total || 0)}`);
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
    builder.add(PrinterCommands.BOLD_ON);
    builder.add(PrinterCommands.TEXT_DOUBLE_SIZE);
    builder.textLine("KOT");
    builder.add(PrinterCommands.TEXT_NORMAL);
    builder.textLine("Kitchen Order Ticket");
    builder.add(PrinterCommands.BOLD_OFF);

    builder.add(PrinterCommands.ALIGN_LEFT);
    builder.textLine(`Date: ${new Date(data.date).toLocaleString()}`);
    if (data.tableNumber) {
        builder.add(PrinterCommands.BOLD_ON);
        builder.textLine(`Table: ${data.tableNumber}`);
        builder.add(PrinterCommands.BOLD_OFF);
    }
    if (data.guestNumber) builder.textLine(`Guests: ${data.guestNumber}`);

    builder.textLine("-".repeat(32));
    builder.add(PrinterCommands.BOLD_ON);
    builder.textLine("Qty  Item");
    builder.add(PrinterCommands.BOLD_OFF);
    builder.textLine("-".repeat(32));

    if (data.items) {
        data.items.forEach(item => {
            builder.add(PrinterCommands.BOLD_ON);
            builder.textLine(`${item.quantity} x ${item.productName}`);
            builder.add(PrinterCommands.BOLD_OFF);
            if (item.details) {
                builder.textLine(`   Details: ${item.details}`);
            }
        });
    }

    builder.textLine("-".repeat(32));
    if (data.specialNotes) {
        builder.add(PrinterCommands.BOLD_ON);
        builder.textLine("NOTES:");
        builder.textLine(data.specialNotes);
        builder.add(PrinterCommands.BOLD_OFF);
    }

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
        // ESC/POS Barcode height
        builder.add([GS, 0x68, 80]); // Height = 80
        // Barcode width
        builder.add([GS, 0x77, 2]); // Width = 2
        // Print position (HRI)
        builder.add([GS, 0x48, 2]); // Below barcode

        // Code128 format (simple)
        // Function B (Code 128)
        const barcodeBytes = stringToBytes(data.sku);

        // Command: GS k <m> <n> <d1...dn>
        // m=73 for Code128
        builder.add([GS, 0x6B, 73, barcodeBytes.length]);
        builder.add(barcodeBytes);

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
