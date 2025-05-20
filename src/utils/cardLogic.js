export const CARD_PATTERN = {
    SINGLE: 'SINGLE',         // 单张
    PAIR: 'PAIR',             // 对子
    CONSECUTIVE_PAIRS: 'CONSECUTIVE_PAIRS', // 连对
    FLASH: 'FLASH',           // 闪
    THUNDER: 'THUNDER',       // 震
    RAIN: 'RAIN'              // 雨
};

export const isMainCard = (card, mainSuit, commonMain) => {
    if(!card) return false;
    if (card.suit === 'JOKER') return true;
    if (mainSuit && card.suit === mainSuit) return true;
    if (commonMain && card.value === commonMain) return true;
    if (['2', '3', '5'].includes(card.value)) return true;
    return false;
};

export const isSameSuitPair = (cards) => {
    if (cards.length !== 2) return false;
    return cards[0].suit === cards[1].suit && cards[0].value === cards[1].value;
};

// Primary getCardRank for comparisons, used by getPatternDetails etc.
export const getCardRank = (card, mainSuit, commonMain) => {
    if (!card) return -1;
    if (card.suit === 'JOKER') return card.value === 'BIG' ? 100 : 99;

    const isTrump = isMainCard(card, mainSuit, commonMain);
    let rank = 0;
    const valueOrder = ['4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const fixedCommonValues = ['2', '3', '5'];

    if (isTrump) {
        rank += 50;
        if (card.value === commonMain) {
            rank += (card.suit === mainSuit) ? 40 : 39;
        } else if (fixedCommonValues.includes(card.value)) {
            const base = 38 - fixedCommonValues.indexOf(card.value) * 2;
            rank += (card.suit === mainSuit) ? base : base - 1;
        } else if (card.suit === mainSuit) {
            const index = valueOrder.indexOf(card.value);
            if (index !== -1) {
                rank += index + 15;
            }
        }
    } else {
        const index = valueOrder.indexOf(card.value);
         if (index !== -1) {
            rank += index;
         }
    }
    return rank;
};

// Specific getMainCardRank for isConsecutivePairs logic
export const getMainCardRank = (value, suit, mainSuit, commonMain) => {
    if (suit === 'JOKER') return -1;
    if (value === commonMain) {
        return suit === mainSuit ? 20 : 19;
    }
    const fixedCommonValues = ['5', '3', '2'];
    if (fixedCommonValues.includes(value)) {
        const baseRank = 15 - fixedCommonValues.indexOf(value) * 2;
        return suit === mainSuit ? baseRank : baseRank - 1;
    }
    if (suit === mainSuit) {
        const normalValues = ['4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        const index = normalValues.indexOf(value);
        if (index !== -1) {
            return index;
        }
    }
    return -1;
};

export const isConsecutivePairs = (cards, mainSuit, commonMain) => {
    if (cards.length < 4 || cards.length % 2 !== 0) return false;
    const valueGroups = {};
    cards.forEach(card => {
        if (!valueGroups[card.value]) {
            valueGroups[card.value] = [];
        }
        valueGroups[card.value].push(card);
    });

    const pairDetails = [];
    let category = null;
    let isValid = true;

    for (const value in valueGroups) {
        const cardsWithValue = valueGroups[value];
        if (cardsWithValue.length % 2 !== 0) {
            isValid = false; break;
        }
        const suitCounts = {};
        cardsWithValue.forEach(card => {
            suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
        });
        if (Object.values(suitCounts).some(count => count % 2 !== 0)) {
            isValid = false; break;
        }
        for (const suit in suitCounts) {
            const numPairs = suitCounts[suit] / 2;
            const representativeCard = cardsWithValue.find(c => c.suit === suit);
            const isMain = isMainCard(representativeCard, mainSuit, commonMain);
            const currentPairCategory = isMain ? 'main' : suit;
            if (category === null) {
                category = currentPairCategory;
            } else if (category !== currentPairCategory) {
                isValid = false; break;
            }
            for (let i = 0; i < numPairs; i++) {
                pairDetails.push({ value, suit, isMain });
            }
        }
        if (!isValid) break;
    }

    if (!isValid || category === null || pairDetails.length < 2) return false;

    if (category === 'main') {
        pairDetails.sort((a, b) => getMainCardRank(a.value, a.suit, mainSuit, commonMain) - getMainCardRank(b.value, b.suit, mainSuit, commonMain));
        for (let i = 1; i < pairDetails.length; i++) {
            const rankPrev = getMainCardRank(pairDetails[i-1].value, pairDetails[i-1].suit, mainSuit, commonMain);
            const rankCurr = getMainCardRank(pairDetails[i].value, pairDetails[i].suit, mainSuit, commonMain);
            if (rankCurr - rankPrev !== 1) return false;
        }
        return true;
    } else {
        const normalValues = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        const uniquePairValues = [...new Set(pairDetails.map(p => p.value))];
        uniquePairValues.sort((a, b) => normalValues.indexOf(a) - normalValues.indexOf(b));
        for (let i = 1; i < uniquePairValues.length; i++) {
            const prevIndex = normalValues.indexOf(uniquePairValues[i - 1]);
            const currIndex = normalValues.indexOf(uniquePairValues[i]);
            if (currIndex === -1 || prevIndex === -1 || currIndex - prevIndex !== 1) return false;
        }
        return true;
    }
};

export const isFlash = (cards, mainSuit, commonMain) => {
    if (!cards || cards.length !== 4) return false;
    const value = cards[0].value;
    if (!cards.every(card => card.value === value)) return false;
    const validFlashValues = ['2', '3', '5'];
    if (commonMain) validFlashValues.push(commonMain);
    if (!validFlashValues.includes(value)) return false;
    const suits = new Set(cards.map(card => card.suit));
    return suits.size === 4;
};

export const isThunder = (cards, mainSuit, commonMain) => {
    if (!cards || cards.length <= 4) return false;
    const value = cards[0].value;
    if (!cards.every(card => card.value === value)) return false;
    const validThunderValues = ['2', '3', '5'];
    if (commonMain) validThunderValues.push(commonMain);
    if (!validThunderValues.includes(value)) return false;
    const uniqueSuits = new Set(cards.map(card => card.suit));
    return uniqueSuits.size === 4;
};

export const isRain = (cards) => {
    if (cards.length < 5) return false;
    const suit = cards[0].suit;
    if (!cards.every(card => card.suit === suit)) return false;
    const valueGroups = {};
    cards.forEach(card => {
        if (!valueGroups[card.value]) valueGroups[card.value] = [];
        valueGroups[card.value].push(card);
    });
    const normalValues = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const values = Object.keys(valueGroups).sort((a, b) => normalValues.indexOf(a) - normalValues.indexOf(b));
    let consecutiveCount = 1;
    for (let i = 1; i < values.length; i++) {
        const prevIndex = normalValues.indexOf(values[i - 1]);
        const currIndex = normalValues.indexOf(values[i]);
        if (currIndex - prevIndex === 1) {
            consecutiveCount++;
        } else {
            consecutiveCount = 1;
        }
        if (consecutiveCount >= 5) return true;
    }
    return false;
};

export const isValidCardPattern = (cards, mainSuit, commonMain) => {
    if (!cards || cards.length === 0) return false;
    if (cards.length === 1) return true;
    if (cards.length === 2) return isSameSuitPair(cards);
    if (cards.length === 4) {
         if (isFlash(cards, mainSuit, commonMain)) return true;
         if (isConsecutivePairs(cards, mainSuit, commonMain)) return true;
        return false;
    }
    if (cards.length > 4 && cards.length % 2 === 0) {
         if (isConsecutivePairs(cards, mainSuit, commonMain)) return true;
    }
    if (cards.length > 4) {
         if (isThunder(cards, mainSuit, commonMain)) return true;
    }
    if (cards.length >= 5) {
         if (isRain(cards)) return true;
    }
    return false;
};

export const getPatternDetails = (cards, mainSuit, commonMain) => {
    if (!cards || cards.length === 0) return null;
    const count = cards.length;
    const firstCard = cards[0];
    let pattern = null;
    let suit = null;
    let isTrumpSet = cards.every(c => isMainCard(c, mainSuit, commonMain));
    let rank = -1;

    if (!isTrumpSet) {
        const firstSuitVal = firstCard.suit;
        if (firstSuitVal !== 'JOKER' && cards.every(c => c.suit === firstSuitVal || isMainCard(c, mainSuit, commonMain))) {
             if (firstSuitVal !== mainSuit && !isMainCard(firstCard, mainSuit, commonMain)) {
                  suit = firstSuitVal;
             }
        }
    } else {
        suit = 'TRUMP';
    }

    if (count === 1) {
        pattern = CARD_PATTERN.SINGLE;
        suit = isTrumpSet ? 'TRUMP' : firstCard.suit;
        rank = getCardRank(firstCard, mainSuit, commonMain);
    } else if (count === 2 && isSameSuitPair(cards)) {
        pattern = CARD_PATTERN.PAIR;
        suit = isTrumpSet ? 'TRUMP' : firstCard.suit;
        rank = getCardRank(firstCard, mainSuit, commonMain);
    } else if (count >= 4 && count % 2 === 0 && isConsecutivePairs(cards, mainSuit, commonMain)) {
        pattern = CARD_PATTERN.CONSECUTIVE_PAIRS;
        suit = isTrumpSet ? 'TRUMP' : cards.find(c => !isMainCard(c, mainSuit, commonMain))?.suit || 'TRUMP';
        // cards.sort((a, b) => getCardRank(b, mainSuit, commonMain) - getCardRank(a, mainSuit, commonMain)); // Sorting might be done by caller or based on context
        // rank = getCardRank(cards[0], mainSuit, commonMain); // Rank of highest pair
        // For consecutive pairs, the rank of the highest card of the highest pair is often used.
        // Let's sort a copy to determine rank without modifying original `cards` array.
        const sortedCopy = [...cards].sort((a, b) => getCardRank(b, mainSuit, commonMain) - getCardRank(a, mainSuit, commonMain));
        rank = getCardRank(sortedCopy[0], mainSuit, commonMain);

    } else if (count === 4 && isFlash(cards, mainSuit, commonMain)) {
        pattern = CARD_PATTERN.FLASH;
        suit = 'MIXED';
        isTrumpSet = true;
        rank = getCardRank(cards.find(c=>c.value === firstCard.value && c.suit === mainSuit) || firstCard, mainSuit, commonMain) + 100;
    } else if (count > 4 && isThunder(cards, mainSuit, commonMain)) {
        pattern = CARD_PATTERN.THUNDER;
        suit = 'MIXED';
        isTrumpSet = true;
        rank = getCardRank(cards.find(c=>c.value === firstCard.value && c.suit === mainSuit) || firstCard, mainSuit, commonMain) + 150 + count;
    } else if (count >= 5 && isRain(cards)) {
        pattern = CARD_PATTERN.RAIN;
        suit = firstCard.suit;
        // isTrumpSet = cards.every(c => isMainCard(c, mainSuit, commonMain)); // Re-evaluate if rain can be trump
        // Rank of the highest card in the sequence
        const sortedCopy = [...cards].sort((a, b) => getCardRank(b, mainSuit, commonMain) - getCardRank(a, mainSuit, commonMain));
        rank = getCardRank(sortedCopy[0], mainSuit, commonMain);
    } else {
        pattern = 'UNKNOWN';
    }

     if (pattern !== 'UNKNOWN' && suit === null) {
         if (isTrumpSet) {
             suit = 'TRUMP';
         } else {
             const nonTrumpSuits = new Set(cards.filter(c => !isMainCard(c, mainSuit, commonMain)).map(c => c.suit));
             if (nonTrumpSuits.size === 1) {
                 suit = nonTrumpSuits.values().next().value;
             } else {
                  suit = 'MIXED/UNKNOWN';
             }
         }
     }

    return { pattern, suit, isTrumpSet, rank, count, cards: [...cards] };
};

export const getHandCardsOfSuit = (playerHand, suit, mainSuit, commonMain) => {
    if (!playerHand || !suit || suit === 'TRUMP' || suit === 'MIXED' || suit === 'JOKER') return [];
    return playerHand.filter(card => card.suit === suit && !isMainCard(card, mainSuit, commonMain));
};

export const getHandTrumpCards = (playerHand, mainSuit, commonMain) => {
    if (!playerHand) return [];
    return playerHand.filter(card => isMainCard(card, mainSuit, commonMain));
};

export const canPlayerMakePatternFromSubset = (cardsSubset, targetPatternDetails, mainSuit, commonMain) => {
    if (!cardsSubset || !targetPatternDetails) return false;
     if (targetPatternDetails.pattern !== CARD_PATTERN.SINGLE && cardsSubset.length < targetPatternDetails.count) {
        return false;
    }
    if (targetPatternDetails.pattern === CARD_PATTERN.SINGLE && cardsSubset.length < 1) {
        return false;
    }

    switch (targetPatternDetails.pattern) {
        case CARD_PATTERN.SINGLE:
            return cardsSubset.length >= 1;
        case CARD_PATTERN.PAIR:
            const pairCounts = {};
            cardsSubset.forEach(card => { pairCounts[card.value] = (pairCounts[card.value] || 0) + 1; });
            return Object.values(pairCounts).some(count => count >= 2);
        case CARD_PATTERN.CONSECUTIVE_PAIRS:
            const availablePairs = [];
            const valueGroups = {};
            cardsSubset.forEach(card => {
                if (!valueGroups[card.value]) valueGroups[card.value] = [];
                valueGroups[card.value].push(card);
            });
            for (const value in valueGroups) {
                if (valueGroups[value].length >= 2) {
                    availablePairs.push({
                        value: value,
                        suit: valueGroups[value][0].suit,
                        rank: getCardRank(valueGroups[value][0], mainSuit, commonMain)
                    });
                }
            }
            if (availablePairs.length < (targetPatternDetails.count / 2)) return false;
            availablePairs.sort((a, b) => a.rank - b.rank);
            const requiredNumPairs = targetPatternDetails.count / 2;
            if (availablePairs.length < requiredNumPairs) return false;
            for (let i = 0; i <= availablePairs.length - requiredNumPairs; i++) {
                let isConsecutiveChain = true;
                for (let j = 0; j < requiredNumPairs - 1; j++) {
                    const pair1 = availablePairs[i + j];
                    const pair2 = availablePairs[i + j + 1];
                    const rankDiff = pair2.rank - pair1.rank;
                    const isPair1Trump = isMainCard({value: pair1.value, suit: pair1.suit} , mainSuit, commonMain); // Pass card object
                    const isPair2Trump = isMainCard({value: pair2.value, suit: pair2.suit}, mainSuit, commonMain); // Pass card object

                    if (isPair1Trump !== isPair2Trump) { isConsecutiveChain = false; break; }
                    if (rankDiff !== 1) { // Simplified check: relies on getCardRank to create continuous ranks for trumps and non-trump sequences.
                        // More robust check for non-trumps would involve valueOrder index
                        if (!isPair1Trump) {
                             const normalValues = ['4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
                             const valIndex1 = normalValues.indexOf(pair1.value);
                             const valIndex2 = normalValues.indexOf(pair2.value);
                             if (valIndex1 === -1 || valIndex2 === -1 || (valIndex2 - valIndex1 !== 1)) {
                                 isConsecutiveChain = false; break;
                             }
                        } else {
                             isConsecutiveChain = false; break;
                        }
                    }
                }
                if (isConsecutiveChain) return true;
            }
            return false;
        case CARD_PATTERN.FLASH:
        case CARD_PATTERN.THUNDER:
        case CARD_PATTERN.RAIN:
            const subsetExactPattern = getPatternDetails(cardsSubset, mainSuit, commonMain);
            return subsetExactPattern && subsetExactPattern.pattern === targetPatternDetails.pattern &&
                   subsetExactPattern.count >= targetPatternDetails.count &&
                   subsetExactPattern.rank >= targetPatternDetails.rank;
        default:
            return false;
    }
};

export const isValidFollow = (selected, playerHand, leadInfo, mainSuit, commonMain) => {
    if (!leadInfo || !leadInfo.cards || leadInfo.cards.length === 0) return false;
    if (!selected || selected.length === 0) return false;
    if (!playerHand || playerHand.length === 0) return false;
    if (!mainSuit) return false;
    const requiredCount = leadInfo.cards.length;
    if (selected.length !== requiredCount) return false;

    const leadDetails = getPatternDetails(leadInfo.cards, mainSuit, commonMain);
    if (!leadDetails || leadDetails.pattern === 'UNKNOWN') return false;

    // For follow validation, selectedDetails might not always match leadDetails.pattern if it's a downgraded play.
    // So, direct analysis of 'selected' cards is often needed.
    // However, getPatternDetails on 'selected' is still useful for毙牌 (trump plays).
    const selectedDetails = getPatternDetails(selected, mainSuit, commonMain);


    const handTrumpCards = getHandTrumpCards(playerHand, mainSuit, commonMain);

    if (leadDetails.isTrumpSet || leadDetails.suit === 'TRUMP') { // Leading with trump
        if (handTrumpCards.length > 0) { // Must follow trump if has
            if (!selected.every(c => isMainCard(c, mainSuit, commonMain))) return false;
            if (!selectedDetails || selectedDetails.pattern !== leadDetails.pattern) return false; // Pattern must match
            // TODO: Add rank comparison for trump over trump (超吃)
            return true;
        } else { // No trump, can play anything (垫牌)
            return true;
        }
    } else { // Leading with a non-trump suit (副牌)
        const leadSuit = leadDetails.suit;
        if (!leadSuit || leadSuit === 'MIXED' || leadSuit === 'UNKNOWN') return false; // Should be a specific suit

        const handLeadSuitCards = getHandCardsOfSuit(playerHand, leadSuit, mainSuit, commonMain);

        if (handLeadSuitCards.length > 0) { // Has cards of the leading suit
            const canMakeExactLeadPatternInSuit = canPlayerMakePatternFromSubset(handLeadSuitCards, leadDetails, mainSuit, commonMain);

            if (canMakeExactLeadPatternInSuit) { // Must follow with that exact pattern in that suit
                if (selected.some(c => c.suit !== leadSuit || isMainCard(c, mainSuit, commonMain))) return false; // Must be all leadSuit, non-trump
                const actualSelectedPattern = getPatternDetails(selected, mainSuit, commonMain); // Analyze what was actually selected
                if(!actualSelectedPattern || actualSelectedPattern.pattern !== leadDetails.pattern) return false;
                // TODO: Compare rank if甩牌 and this is the largest part
                return true;
            } else { // Cannot make exact pattern in lead suit -> Downgraded play or play all of suit + pad/trump
                const allSelectedArePureLeadSuit = selected.every(c => c.suit === leadSuit && !isMainCard(c, mainSuit, commonMain));

                // Downgrade rule: Lead PAIR, follow with two SINGLES of lead suit
                if (leadDetails.pattern === CARD_PATTERN.PAIR && requiredCount === 2) {
                    if (allSelectedArePureLeadSuit) return true;
                }
                // Downgrade rule: Lead 2xCONSECUTIVE_PAIRS (4 cards), follow with 4 SINGLES or two non-consecutive PAIRS of lead suit
                if (leadDetails.pattern === CARD_PATTERN.CONSECUTIVE_PAIRS && leadDetails.count === 4) {
                    if (allSelectedArePureLeadSuit) {
                        // Check if selected are 4 singles or two pairs
                        // This is simplified: if they are all pure lead suit and count matches, allow.
                        // More precise check: getPatternDetails(selected) could be PAIR (if two pairs) or UNKNOWN (if 4 singles)
                        return true;
                    }
                }

                // If not a specific downgrade, must play all cards of lead suit, then pad/trump
                const selectedLeadSuitCards = selected.filter(c => c.suit === leadSuit && !isMainCard(c, mainSuit, commonMain));
                const selectedTrumpCards = selected.filter(c => isMainCard(c, mainSuit, commonMain));
                const selectedPaddingCards = selected.filter(c => c.suit !== leadSuit && !isMainCard(c, mainSuit, commonMain));

                // Must play all available lead suit cards if they are fewer than required count
                if (handLeadSuitCards.length < requiredCount) {
                    if (selectedLeadSuitCards.length !== handLeadSuitCards.length) return false; // Didn't play all available
                } else { // Has enough or more lead suit cards, but couldn't make the pattern
                     // In this case, if not following a specific downgrade rule, this path might be complex.
                     // The general rule is "出完该花色". If handLeadSuitCards.length >= requiredCount,
                     // and couldn't make the pattern, it means player *must* play requiredCount of leadSuit cards,
                     // potentially breaking pairs/sequences if necessary to meet the count, IF that's allowed.
                     // For now, if specific downgrades above don't match, and couldn't make exact pattern,
                     // and has enough cards of the suit, this might be an invalid play unless it's playing ALL of the suit
                     // or forming some other valid (but not exact match) play of that suit.
                     // This part of the logic is tricky. The current canPlayerMakePatternFromSubset is a bit strict.

                     // Simplified: if not a specific downgrade, and cannot make exact pattern,
                     // then selected MUST consist of ALL handLeadSuitCards (if count < required) and then pad/trump.
                     // OR, if handLeadSuitCards >= required, selected must be all lead suit cards.
                     if (selectedLeadSuitCards.length !== requiredCount && !allSelectedArePureLeadSuit) {
                         // If not a specific downgrade, and selection isn't all pure lead suit, it's complex.
                         // Let's assume for now if !canMakeExact, and not a specific downgrade, it might mean
                         // playing all of the suit then padding.
                     }
                }


                const remainingToFill = requiredCount - selectedLeadSuitCards.length;
                if (remainingToFill < 0) return false; // Should not happen if logic above is right

                if (selectedTrumpCards.length + selectedPaddingCards.length !== remainingToFill) return false; // Incorrect fill count
                if (selectedPaddingCards.length > 0 && selectedTrumpCards.length > 0) return false; // Cannot mix trump and other suits for padding

                return true; // Allowed to play all of suit + pad OR all of suit + trump
            }
        } else { // No cards of the leading suit: can trump (毙牌) or play other suits (垫牌)
            const isAllTrump = selected.every(c => isMainCard(c, mainSuit, commonMain));
            const isAllOtherSideSuit = selected.every(c => !isMainCard(c, mainSuit, commonMain) && c.suit !== leadSuit);

            if (isAllTrump) { // Trumping
                if (!selectedDetails || selectedDetails.pattern !== leadDetails.pattern) return false; // Trump pattern must match lead pattern
                // TODO: Compare rank for trump over non-trump (always wins), or trump over trump
                return true;
            } else if (isAllOtherSideSuit) { // Padding with other suits
                return true;
            } else { // Mixed, invalid
                return false;
            }
        }
    }
};

export const getCardWeight = (card, mainSuit, commonMain) => {
    if (!card) return -100;
    if (card.suit === 'JOKER') {
        return card.value === 'BIG' ? 10000 : 9999;
    }
    const suitOrder = { 'SPADES': 300, 'HEARTS': 200, 'CLUBS': 100, 'DIAMONDS': 0 };
    let weight = suitOrder[card.suit] || 0;
    let valueRank = 0;
    const valueOrder = ['4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const fixedCommonValues = ['2', '3', '5'];
    const isTrump = isMainCard(card, mainSuit, commonMain);

    if (isTrump) {
        weight = 5000;
        if (card.value === commonMain) {
            weight += (card.suit === mainSuit) ? 400 : 390;
        } else if (fixedCommonValues.includes(card.value)) {
            const fixedRankBase = 380 - (fixedCommonValues.indexOf(card.value) * 20);
            weight += (card.suit === mainSuit) ? fixedRankBase : fixedRankBase - 5;
        } else if (card.suit === mainSuit) {
            valueRank = valueOrder.indexOf(card.value);
            if (valueRank !== -1) weight += 100 + valueRank * 10;
            else weight += 50;
        } else {
            weight += 0;
        }
    } else {
        valueRank = valueOrder.indexOf(card.value);
        if (valueRank !== -1) weight += valueRank * 10;
    }
    return weight;
};

export const sortCards = (cards, mainSuit, commonMain) => {
    if (!cards || !Array.isArray(cards)) return [];
    return [...cards].sort((a, b) => getCardWeight(b, mainSuit, commonMain) - getCardWeight(a, mainSuit, commonMain));
};

export const isConsecutive = (value1, value2) => {
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const index1 = values.indexOf(value1);
    const index2 = values.indexOf(value2);
    return Math.abs(index1 - index2) === 1;
}; 