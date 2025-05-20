// server/gameUtils.js

// 处理机器人出牌
function handleBotPlay(botPlayer, gameState, roomId, io, endRound) {
    // 延迟2秒出牌，模拟思考时间
    setTimeout(() => {
        let validPlay = null;
        let playedPredefined = false; // 标记是否成功执行了预设出牌

        // --- 为受控机器人添加的测试逻辑 开始 ---
        if (gameState.testConfig && gameState.testConfig.controlledBotId === botPlayer.id) {
            const isLeadingThisTrick = gameState.firstPlayerInRound === botPlayer.id && gameState.roundCards.length === 0;

            if (isLeadingThisTrick && gameState.testConfig.currentLeadIndex < gameState.testConfig.predefinedLeads.length) {
                const predefinedCardsToPlay = gameState.testConfig.predefinedLeads[gameState.testConfig.currentLeadIndex];
                
                // 验证机器人手牌中是否有这些预设的牌
                let botActuallyHasCards = true;
                const botHandForValidation = [...botPlayer.cards]; // 创建手牌副本用于验证，以正确处理重复牌

                for (const cardToPlay of predefinedCardsToPlay) {
                    const cardInHandIndex = botHandForValidation.findIndex(
                        handCard => handCard.suit === cardToPlay.suit && handCard.value === cardToPlay.value
                    );
                    if (cardInHandIndex !== -1) {
                        botHandForValidation.splice(cardInHandIndex, 1); // 从副本中移除，以便正确校验同点数多张牌
                    } else {
                        botActuallyHasCards = false;
                        break;
                    }
                }

                if (botActuallyHasCards) {
                    validPlay = predefinedCardsToPlay;
                    gameState.testConfig.currentLeadIndex++;
                    playedPredefined = true;
                    console.log(`[受控机器人 ${botPlayer.id}] 打出预设牌组 #${gameState.testConfig.currentLeadIndex -1}:`, validPlay);
                } else {
                    console.error(`[受控机器人 ${botPlayer.id}] 错误: 手牌中没有预设的牌组 #${gameState.testConfig.currentLeadIndex}:`, predefinedCardsToPlay, "当前手牌:", botPlayer.cards);
                    // playedPredefined 保持 false，将回退到标准AI
                }
            } else if (isLeadingThisTrick) {
                // 是受控机器人且轮到它领出，但预设牌组已用完
                console.log(`[受控机器人 ${botPlayer.id}] 预设牌组已用完，使用标准AI逻辑。`);
            }
        }
        // --- 为受控机器人添加的测试逻辑 结束 ---

        if (!playedPredefined) { // 如果没有执行预设出牌，则使用标准AI逻辑
            const isBotLeadingThisTrick = gameState.firstPlayerInRound === botPlayer.id && gameState.roundCards.length === 0;

            if (isBotLeadingThisTrick) { // 机器人领出这一轮
                if (botPlayer.cards.length > 0) {
                    validPlay = [botPlayer.cards[0]]; // 简单AI：出第一张牌
                    console.log(`[机器人AI ${botPlayer.id}] 领出:`, validPlay);
                } else {
                    console.log(`[机器人AI ${botPlayer.id}] 领出但没有手牌。`);
                }
            } else if (gameState.roundCards.length > 0) { // 机器人跟牌
                const firstPlayInTrick = gameState.roundCards[0];
                const cardsRequired = firstPlayInTrick.cards.length;
                
                console.log(`[机器人AI ${botPlayer.id}] 跟牌，需要 ${cardsRequired} 张牌`);
                
                if (botPlayer.cards.length >= cardsRequired) {
                    validPlay = botPlayer.cards.slice(0, cardsRequired); // 简单AI：出前面N张牌
                    console.log(`[机器人AI ${botPlayer.id}] 跟牌:`, validPlay);
                } else if (botPlayer.cards.length > 0) { // 牌不够，但有牌可出
                    validPlay = [...botPlayer.cards]; // 出掉所有手牌
                    console.log(`[机器人AI ${botPlayer.id}] 跟牌时牌不够，出所有牌 (${validPlay.length}):`, validPlay);
                } else {
                    console.log(`[机器人AI ${botPlayer.id}] 跟牌但没有手牌。`);
                }
            }
            // 如果 validPlay 仍然是 null (例如，在非领出也非跟牌的罕见情况下，或者机器人确实没牌了)，
            // 后续逻辑会处理这种情况。
        }
        
        if (validPlay && validPlay.length > 0) {
            // 从机器人手牌中移除这些牌 (注意：原有的 filter 方法在处理手牌与出牌都有重复牌时可能不完美)
            botPlayer.cards = botPlayer.cards.filter(card => 
                !validPlay.some(pc => pc.suit === card.suit && pc.value === card.value)
            );
            
            // 根据牌数量确定牌型 (这是非常简化的牌型判断)
            let pattern = 'SINGLE';
            if (validPlay.length === 2) pattern = 'PAIR';
            else if (validPlay.length === 4) pattern = 'CONSECUTIVE_PAIRS'; // 假设是连对
            else if (validPlay.length >= 5) pattern = 'RAIN'; // 假设是甩牌/雨
            
            // 更新游戏状态
            gameState.roundCards.push({
                player: botPlayer.id,
                cards: validPlay,
                pattern: pattern // 使用简化的牌型
            });
            
            // 通知所有玩家有人出牌
            io.to(roomId).emit('cardPlayed', {
                player: botPlayer.id,
                cards: validPlay,
                pattern: pattern,
                playerName: botPlayer.name
            });
            
            // 判断这一轮是否结束
            const allPlayersPlayedThisTrick = gameState.roundCards.length === gameState.players.length;
            
            if (allPlayersPlayedThisTrick) {
                // 轮次结束，确定赢家并开始新一轮
                endRound(gameState, roomId, io, handleBotPlay); // 将 handleBotPlay 自身传递下去，以便机器人开始下一轮
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
                    isFirstPlayer: gameState.currentPlayer === gameState.firstPlayerInRound // 下一个玩家是否为新一轮的首出
                });
                
                // 如果下一个玩家是机器人，让它自动出牌
                if (nextPlayer.isBot) {
                    handleBotPlay(nextPlayer, gameState, roomId, io, endRound);
                }
            }
        } else {
            // 机器人没有合适的牌可以出，或者没有手牌了
            console.log(`[机器人 ${botPlayer.id}] 没有可出的牌或决策为不出。`);
            
            // 逻辑上，如果机器人不能出牌（例如，在严格的跟牌规则下，没有合法的牌），
            // 游戏规则可能会定义为"过"或强制垫牌。
            // 当前简化逻辑：轮到下一个玩家 (这可能需要根据实际游戏规则调整)
            const currentPlayerIndex = gameState.players.findIndex(p => p.id === botPlayer.id);
            const nextPlayerIndex = (currentPlayerIndex + 1) % gameState.players.length;
            const nextPlayer = gameState.players[nextPlayerIndex];
            gameState.currentPlayer = nextPlayer.id;
            
            io.to(roomId).emit('playerTurn', {
                player: gameState.currentPlayer,
                playerName: nextPlayer.name,
                isFirstPlayer: gameState.currentPlayer === gameState.firstPlayerInRound
            });
            
            if (nextPlayer.isBot) {
                handleBotPlay(nextPlayer, gameState, roomId, io, endRound);
            }
        }
    }, 2000); // 保持2秒延迟
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
