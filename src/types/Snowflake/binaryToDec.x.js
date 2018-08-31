// @ts-nocheck

function binaryToDecimal(bin) {
	let dec = 0n;

	for (let i = 0, l = bin.length; i < l; i++) {
		dec = dec * 2n;
		
		if (bin[i] === "1") {
			dec += 1n;
		}
	}

	return dec.toString();
}

module.exports = binaryToDecimal;
