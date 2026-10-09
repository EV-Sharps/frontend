(function (root) {
    'use strict';

    const MAX_AMOUNT = 1000000000;
    const MAX_CENTS = BigInt(MAX_AMOUNT * 100);

    function americanRatio(odds, side) {
        if (!Number.isSafeInteger(odds) || Math.abs(odds) < 100) {
            throw new RangeError(`Enter whole American odds of -100 or lower, or +100 or higher, for side ${side + 1}.`);
        }
        const magnitude = BigInt(Math.abs(odds));
        return odds > 0
            ? { numerator: magnitude + 100n, denominator: 100n }
            : { numerator: magnitude + 100n, denominator: magnitude };
    }

    function checkedMoney(cents) {
        if (cents > MAX_CENTS) {
            throw new RangeError('Reduce the stake or odds so all calculated amounts are at most $1,000,000,000.');
        }
        return Number(cents) / 100;
    }

    function calculateArbitrage(input) {
        if (!input || !Array.isArray(input.odds) || input.odds.length !== 2) {
            throw new RangeError('Enter American odds for both sides.');
        }
        const { odds, stake, stakeSide } = input;
        const ratios = [americanRatio(odds[0], 0), americanRatio(odds[1], 1)];
        if (stakeSide !== 0 && stakeSide !== 1) {
            throw new RangeError('Choose side 1 or side 2 as the stake to hold fixed.');
        }
        if (!Number.isFinite(stake) || stake < 0 || stake > MAX_AMOUNT) {
            throw new RangeError('Enter a stake from $0 to $1,000,000,000.');
        }

        const otherSide = 1 - stakeSide;
        const anchor = ratios[stakeSide];
        const other = ratios[otherSide];
        const stakeCents = [0n, 0n];
        // Correct floating-point drift at half cents before normal currency rounding.
        stakeCents[stakeSide] = BigInt(Math.round((stake + Number.EPSILON * Math.max(1, stake)) * 100));
        const numerator = stakeCents[stakeSide] * anchor.numerator * other.denominator;
        const denominator = anchor.denominator * other.numerator;
        stakeCents[otherSide] = (2n * numerator + denominator) / (2n * denominator);

        // Integer ratios keep penny boundaries exact. Round payouts down so the
        // displayed minimum never promises more than either outcome pays.
        const payoutCents = stakeCents.map((amount, side) => amount * ratios[side].numerator / ratios[side].denominator);
        const totalStakeCents = stakeCents[0] + stakeCents[1];
        const totalPayoutCents = payoutCents[0] < payoutCents[1] ? payoutCents[0] : payoutCents[1];
        const stakes = stakeCents.map(checkedMoney);
        const payouts = payoutCents.map(checkedMoney);
        const totalStake = checkedMoney(totalStakeCents);
        const totalPayout = checkedMoney(totalPayoutCents);
        const profit = Number(totalPayoutCents - totalStakeCents) / 100;

        return {
            stakes,
            payouts,
            totalStake,
            totalPayout,
            profit,
            roi: totalStake ? profit / totalStake * 100 : 0,
            profitPercent: totalPayout ? profit / totalPayout * 100 : 0,
        };
    }

    function convertOdds(input) {
        if (!input || !['fraction', 'decimal', 'american', 'probability'].includes(input.format)) {
            throw new RangeError('Choose fractional, decimal, American odds, or probability to convert.');
        }
        const { format, value, stake } = input;
        if (!Number.isFinite(value)) {
            throw new RangeError('Enter a valid number for the odds or probability.');
        }
        if (!Number.isFinite(stake) || stake < 0 || stake > MAX_AMOUNT) {
            throw new RangeError('Enter a stake from $0 to $1,000,000,000.');
        }

        let fraction;
        if (format === 'fraction') {
            if (value <= 0) throw new RangeError('Enter fractional odds greater than 0, such as 2 for 2/1.');
            fraction = value;
        } else if (format === 'decimal') {
            if (value <= 1) throw new RangeError('Enter decimal odds greater than 1.');
            fraction = value - 1;
        } else if (format === 'american') {
            if (Math.abs(value) < 100) throw new RangeError('Enter American odds of -100 or lower, or +100 or higher.');
            fraction = value > 0 ? value / 100 : 100 / -value;
        } else {
            if (value <= 0 || value >= 100) throw new RangeError('Enter a probability greater than 0% and less than 100%.');
            fraction = (100 - value) / value;
        }

        const decimal = format === 'decimal' ? value : 1 + fraction;
        const american = format === 'american' && value !== -100
            ? value
            : fraction >= 1 ? fraction * 100 : -100 / fraction;
        const probability = format === 'probability' ? value : 100 / decimal;
        if (![fraction, decimal, american, probability].every(Number.isFinite) ||
            fraction <= 0 || decimal <= 1 || probability <= 0 || probability >= 100) {
            throw new RangeError('These odds are too extreme to convert accurately. Enter a value closer to even odds.');
        }

        const stakeCents = Math.round((stake + Number.EPSILON * Math.max(1, stake)) * 100);
        const winnings = stakeCents / 100 * fraction;
        if (!Number.isFinite(winnings) || winnings > MAX_AMOUNT) {
            throw new RangeError('Reduce the stake or odds so all calculated amounts are at most $1,000,000,000.');
        }
        const winCents = Math.round((winnings + Number.EPSILON * Math.max(1, winnings)) * 100);
        const toWin = checkedMoney(BigInt(winCents));
        const payout = checkedMoney(BigInt(stakeCents + winCents));

        return { fraction, decimal, american, probability, toWin, payout };
    }

    const api = { calculateArbitrage, convertOdds, MAX_AMOUNT };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') root.CalculatorsMath = api;
})(typeof window !== 'undefined' ? window : globalThis);
