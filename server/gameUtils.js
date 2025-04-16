// server/gameUtils.js

// 处理机器人出牌
function handleBotPlay(botPlayer, gameState, roomId, io, endRound) {
    // 延迟2秒出牌，模拟思考时间
    setTimeout(() => {
        const isFirstPlayerInRound = gameState.firstPlayerInRound === botPlayer.id;
        let validPlay = null;
        
        // 机器人出牌策略
        // 如果是首位出牌，出一张牌
        if (isFirstPlayerInRound && botPlayer.cards.length > 0) {
            validPlay = [botPlayer.cards[0]];
        }
        // 如果是跟牌，尝试出与第一位玩家相同数量的牌
        else if (gameState.roundCards.length > 0) {
            // 获取第一个出牌玩家的牌数量
            const firstPlay = gameState.roundCards[0];
            const cardsRequired = firstPlay.cards.length;
            
            console.log(`机器人需要出 ${cardsRequired} 张牌`);
            
            // 检查机器人是否有足够的牌
            if (botPlayer.cards.length >= cardsRequired) {
                // 从机器人手牌中选择指定数量的牌
                validPlay = botPlayer.cards.slice(0, cardsRequired);
                
                console.log(`机器人选择了 ${validPlay.length} 张牌:`, validPlay);
            } else {
                console.log(`机器人牌不够，只有 ${botPlayer.cards.length} 张牌`);
                // 如果牌不够，就出所有牌
                validPlay = [...botPlayer.cards];
            }
        }
        
        if (validPlay && validPlay.length > 0) {
            // 从机器人手牌中移除这些牌
            botPlayer.cards = botPlayer.cards.filter(card => 
                !validPlay.some(pc => pc.suit === card.suit && pc.value === card.value)
            );
            
            // 根据牌数量确定牌型
            let pattern = 'SINGLE';
            if (validPlay.length === 2) pattern = 'PAIR';
            else if (validPlay.length === 4) pattern = 'CONSECUTIVE_PAIRS';
            else if (validPlay.length >= 5) pattern = 'RAIN';
            
            // 更新游戏状态
            gameState.roundCards.push({
                player: botPlayer.id,
                cards: validPlay,
                pattern: pattern
            });
            
            // 通知所有玩家有人出牌
            io.to(roomId).emit('cardPlayed', {
                player: botPlayer.id,
                cards: validPlay,
                pattern: pattern,
                playerName: botPlayer.name
            });
            
            // 判断这一轮是否结束
            const allPlayersPlayed = gameState.roundCards.length === gameState.players.length;
            
            if (allPlayersPlayed) {
                // 轮次结束，确定赢家并开始新一轮
                endRound(gameState, roomId, io, handleBotPlay);
            } else {
                // 确定下一个出牌玩家
                const currentPlayerIndex = gameState.players.findIndex(p => p.id === botPlayer.id);
                const nextPlayerIndex = (currentPlayerIndex + 1) % gameState.players.length;
                const nextPlayer = gameState.players[nextPlayerIndex];
                gameState.currentPlayer = nextPlayer.id;
                
                // 通知所有玩家轮到谁出牌
                io.to(roomId).emit('playerTurn', {
                    player: gameState.currentPlayer,
                    playerName: nextPlayer.name,
                    isFirstPlayer: gameState.currentPlayer === gameState.firstPlayerInRound
                });
                
                // 如果下一个玩家是机器人，让它自动出牌
                if (nextPlayer.isBot) {
                    handleBotPlay(nextPlayer, gameState, roomId, io, endRound);
                }
            }
        } else {
            // 机器人没有合适的牌可以出
            console.log('机器人没有合适的牌可以出');
            
            // 进入下一个玩家
            const currentPlayerIndex = gameState.players.findIndex(p => p.id === botPlayer.id);
            const nextPlayerIndex = (currentPlayerIndex + 1) % gameState.players.length;
            const nextPlayer = gameState.players[nextPlayerIndex];
            gameState.currentPlayer = nextPlayer.id;
            
            // 通知所有玩家轮到谁出牌
            io.to(roomId).emit('playerTurn', {
                player: gameState.currentPlayer,
                playerName: nextPlayer.name,
                isFirstPlayer: gameState.currentPlayer === gameState.firstPlayerInRound
            });
            
            // 如果下一个玩家是机器人，让它自动出牌
            if (nextPlayer.isBot) {
                handleBotPlay(nextPlayer, gameState, roomId, io, endRound);
            }
        }
    }, 2000);
}

// 轮次结束，确定赢家并开始新一轮
function endRound(gameState, roomId, io, handleBotPlay) {
    // 确定赢家
    // TODO: 实现复杂的牌型比较逻辑
    // 临时简单逻辑：第一个出牌的玩家获胜
    const winner = gameState.players.find(p => p.id === gameState.firstPlayerInRound);
    
    console.log(`轮次结束，玩家 ${winner.name} 获胜`);
    
    // 设置下一轮的首位出牌玩家为本轮赢家
    gameState.firstPlayerInRound = winner.id;
    gameState.currentPlayer = winner.id;
    
    // 清空本轮出牌记录
    gameState.roundCards = [];
    
    // 通知所有玩家轮次结束
    io.to(roomId).emit('roundEnd', {
        winner: winner.id,
        winnerName: winner.name,
        nextPlayer: winner.id
    });
    
    // 通知所有玩家下一轮开始
    io.to(roomId).emit('playerTurn', {
        player: winner.id,
        playerName: winner.name,
        isFirstPlayer: true
    });
    
    // 如果下一个出牌玩家是机器人，让它自动出牌
    if (winner.isBot) {
        handleBotPlay(winner, gameState, roomId, io, endRound);
    }
}

// 创建两副牌
function createDeck() {
    const suits = ['HEARTS', 'SPADES', 'DIAMONDS', 'CLUBS'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const deck = [];

    for (let i = 0; i < 2; i++) {  // 循环两次
        for (let suit of suits) {
            for (let value of values) {
                deck.push({ suit, value });
            }
        }
        deck.push({ suit: 'JOKER', value: 'BIG' });
        deck.push({ suit: 'JOKER', value: 'SMALL' });
    }

    return deck;
}

// 洗牌函数
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// 添加判断玩家所属队伍的函数
function getPlayerTeam(playerId, players) {
    const playerIndex = players.findIndex(p => p.id === playerId);
    // 1、3号玩家是第1队，2、4号玩家是第2队
    return (playerIndex % 2 === 0) ? 1 : 2;
}

// 添加确定抠底玩家的函数
function determineBottomDealer(gameState) {
    const mainCallerIndex = gameState.players.findIndex(p => p.id === gameState.mainCaller);
    const mainCallerTeam = getPlayerTeam(gameState.mainCaller, gameState.players);
    
    if (mainCallerTeam === gameState.bankerTeam) {
        // 如果叫主的是庄家队，则由队友抠底
        const teamMateIndex = (mainCallerIndex + 2) % 4;
        return gameState.players[teamMateIndex].id;
    } else {
        // 如果叫主的是闲家，则由下家抠底
        const nextPlayerIndex = (mainCallerIndex + 1) % 4;
        return gameState.players[nextPlayerIndex].id;
    }
}

// 辅助函数：交换牌
function exchangeCards(mainPlayer, stickPlayer, stickCards, gameState) {
    // 验证交换的牌是否合法
    const isValidExchange = 
        // 验证常主牌
        (stickCards.commonMain.value === gameState.commonMain || 
         ['2', '3', '5'].includes(stickCards.commonMain.value)) &&
        // 验证主花色牌
        stickCards.suitCards.length === 2 &&
        stickCards.suitCards.every(card => card.suit === gameState.mainSuit);

    if (!isValidExchange) {
        return false;
    }

    // 从主叫玩家的牌中移除用于叫主的牌
    mainPlayer.cards = mainPlayer.cards.filter(card => {
        const mainJoker = gameState.mainCards?.joker;
        const mainPair = gameState.mainCards?.pair;
        
        return !(
            (card.suit === 'JOKER' && card.value === mainJoker) ||
            (mainPair && card.suit === mainPair.suit && card.value === mainPair.value)
        );
    });
    
    // 从粘牌玩家的牌中移除选择的牌
    stickPlayer.cards = stickPlayer.cards.filter(card => 
        !(card.suit === stickCards.commonMain.suit && card.value === stickCards.commonMain.value) &&
        !stickCards.suitCards.some(sc => sc.suit === card.suit && sc.value === card.value)
    );
    
    // 添加交换的牌
    mainPlayer.cards.push(stickCards.commonMain, ...stickCards.suitCards);
    
    // 添加主叫玩家的牌给粘牌玩家
    if (gameState.mainCards) {
        stickPlayer.cards.push(
            { suit: 'JOKER', value: gameState.mainCards.joker },
            { suit: gameState.mainCards.pair.suit, value: gameState.mainCards.pair.value },
            { suit: gameState.mainCards.pair.suit, value: gameState.mainCards.pair.value }
        );
    }

    return true;
}

module.exports = {
    handleBotPlay,
    endRound,
    createDeck,
    shuffleDeck,
    getPlayerTeam,
    determineBottomDealer,
    exchangeCards
};
