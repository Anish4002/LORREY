/**
 * Converts a number to Indian currency words format.
 * Example: 125.50 -> RUPEES ONE HUNDRED TWENTY FIVE AND FIFTY PAISA ONLY
 */
export const toIndianWords = (num) => {
    if (isNaN(num) || num === null || num === undefined) return '';
    if (num === 0) return 'RUPEES ZERO ONLY';

    const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
    const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

    const convertChunk = (n) => {
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
        if (n < 1000) return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' ' + convertChunk(n % 100) : '');
        return '';
    };

    const convertToWords = (n) => {
        if (n === 0) return '';
        let res = '';

        // Crores
        if (n >= 10000000) {
            res += convertToWords(Math.floor(n / 10000000)) + ' CRORE ';
            n %= 10000000;
        }
        // Lakhs
        if (n >= 100000) {
            res += convertChunk(Math.floor(n / 100000)) + ' LAKH ';
            n %= 100000;
        }
        // Thousands
        if (n >= 1000) {
            res += convertChunk(Math.floor(n / 1000)) + ' THOUSAND ';
            n %= 1000;
        }
        // Hundreds/Ones
        if (n > 0) {
            res += convertChunk(n);
        }

        return res.trim();
    };

    const mainPart = Math.floor(Math.abs(num));
    const fractionPart = Math.round((Math.abs(num) - mainPart) * 100);

    let result = 'RUPEES ' + convertToWords(mainPart);
    
    if (fractionPart > 0) {
        result += ' AND ' + convertChunk(fractionPart) + ' PAISA';
    }

    return result.trim() + ' ONLY';
};
