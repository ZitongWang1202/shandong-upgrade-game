const DECK_OF_CARDS = [
    // 黑桃
    ...Array.from({length: 13}, (_, i) => ({
        suit: 'spades',
        value: i + 2 > 10 ? ['J','Q','K','A'][i-10] : (i + 2)
    })),
    // 红心
    ...Array.from({length: 13}, (_, i) => ({
        suit: 'hearts',
        value: i + 2 > 10 ? ['J','Q','K','A'][i-10] : (i + 2)
    })),
    // 梅花
    ...Array.from({length: 13}, (_, i) => ({
        suit: 'clubs',
        value: i + 2 > 10 ? ['J','Q','K','A'][i-10] : (i + 2)
    })),
    // 方块
    ...Array.from({length: 13}, (_, i) => ({
        suit: 'diamonds',
        value: i + 2 > 10 ? ['J','Q','K','A'][i-10] : (i + 2)
    })),
    // 大小王
    {
        suit: 'JOKER',
        value: 'BIG'
    },
    {
        suit: 'JOKER',
        value: 'SMALL'
    }
]

export default DECK_OF_CARDS