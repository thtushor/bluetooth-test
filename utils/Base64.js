const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function customBtoa(input) {
    let str = String(input);
    let output = '';

    for (let block = 0, charCode, i = 0, map = chars;
        str.charAt(i | 0) || (map = '=', i % 1);
        output += map.charAt(63 & block >> 8 - i % 1 * 8)) {
        charCode = str.charCodeAt(i += 3 / 4);
        if (charCode > 0xFF) {
            throw new Error("'btoa' failed: The string to be encoded contains characters outside of the Latin1 range.");
        }
        block = block << 8 | charCode;
    }

    return output;
}

export const btoa = (input) => {
    // Use native btoa if available, otherwise use custom implementation
    return typeof global.btoa === 'function' ? global.btoa(input) : customBtoa(input);
};

export const byteArrayToBase64 = (byteArray) => {
    let binary = '';
    const len = byteArray.length;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(byteArray[i]);
    }
    return customBtoa(binary);
};
