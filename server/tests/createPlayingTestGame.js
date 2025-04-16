// 创建出牌测试游戏
module.exports = function(socket, io, games, rooms, utils) {
    const { createDeck, shuffleDeck, handleBotPlay, endRound, isMainCard } = utils;
    
    socket.on('createPlayingTest', () => {
        console.log('创建出牌测试房间');
        const roomId = Math.random().toString(36).slice(2, 8);
        
        // 添加真实玩家（当前连接的用户）
        const players = [{
            id: socket.id,
            ready: true,
            name: `玩家${socket.id.slice(0, 4)}`
        }];
        
        // 添加3个机器人玩家
        for (let i = 1; i <= 3; i++) {
            const botId = `bot-${i}-${Math.random().toString(36).slice(2, 6)}`;
            players.push({
                id: botId,
                ready: true,
                name: `机器人${i}`,
                isBot: true
            });
        }
        
        // 创建房间
        const room = { id: roomId, players: players };
        
        // --- 定义预设手牌 ---
        const presetPlayerHand = [
            // 黑桃连对 667788
            { suit: 'SPADES', value: '6' }, { suit: 'SPADES', value: '6' },
            { suit: 'SPADES', value: '7' }, { suit: 'SPADES', value: '7' },
            { suit: 'SPADES', value: '8' }, { suit: 'SPADES', value: '8' },
            // 草花 6 7 8 99 10 (测试雨)
            { suit: 'CLUBS', value: '6' }, { suit: 'CLUBS', value: '7' }, 
            { suit: 'CLUBS', value: '8' }, { suit: 'CLUBS', value: '9' }, 
            { suit: 'CLUBS', value: '9' }, { suit: 'CLUBS', value: '10' },
            // 四种花色的 2 (测试闪)
            { suit: 'HEARTS', value: '2' }, { suit: 'SPADES', value: '2' },
            { suit: 'DIAMONDS', value: '2' }, { suit: 'CLUBS', value: '2' },
            // 四种花色5加上红桃5 (测试震)
            { suit: 'SPADES', value: '5' }, { suit: 'DIAMONDS', value: '5' },
            { suit: 'CLUBS', value: '5' }, { suit: 'HEARTS', value: '5' },
            { suit: 'HEARTS', value: '5' }
        ];
        const cardsToDealToPlayer = 26 - presetPlayerHand.length; // 计算需要补充多少张牌
        console.log(`预设手牌 ${presetPlayerHand.length} 张, 需要补充 ${cardsToDealToPlayer} 张`);
        // --- 预设手牌结束 ---

        // 创建牌堆
        const fullDeck = createDeck();
        // console.log('原始牌堆数量:', fullDeck.length);
        
        // 预先准备对家（机器人）的牌
        const botCards = [
            { suit: 'JOKER', value: 'BIG' },  // 大王
            { suit: 'HEARTS', value: 'A' },    // 红桃A
            { suit: 'HEARTS', value: 'A' }     // 红桃A
        ];
        
        // 从牌堆中移除 预设给玩家的牌 和 预设给机器人的牌
        const cardsToRemove = [...presetPlayerHand, ...botCards];
        const deck = [...fullDeck]; // 复制一份以便修改

        cardsToRemove.forEach(cardToRemove => {
            const cardIndex = deck.findIndex(card => 
                card.suit === cardToRemove.suit && card.value === cardToRemove.value
            );
            
            if (cardIndex !== -1) {
                deck.splice(cardIndex, 1);
                // console.log(`已从牌堆中移除 ${botCard.suit} ${botCard.value}`);
            } else {
                // console.log(`牌堆中未找到 ${botCard.suit} ${botCard.value}`);
            }
        });
        
        // console.log('移除预设牌后的牌堆数量:', deck.length);
        
        // 洗牌
        const shuffledDeck = shuffleDeck(deck);
        
        // --- 创建游戏状态 ---
        const tempMainSuit = 'HEARTS'; // 假设的主花色，用于初始化
        const tempCommonMain = '2';   // 假设的常主，用于初始化

        const gameState = {
            deck: shuffledDeck,
            players: players.map(p => {
                // --- 直接分配预设手牌给当前玩家 ---
                if (p.id === socket.id) {
                    return {
                        ...p,
                        cards: [...presetPlayerHand], // 初始化为预设手牌
                        isDealer: false
                    };
                }
                // 其他玩家（机器人）先给空手牌，后面发
                return {
                    ...p,
                    cards: [],
                    isDealer: false
                };
            }),
            currentTurn: null,
            mainSuit: null, // 稍后由机器人叫主设置
            mainCaller: null,
            mainCards: null,
            phase: 'pregame',
            preGameState: {
                isDealing: true,
                canCallMain: true,
                commonMain: '2' // 保持常主为 2
            },
            currentRound: [],
            bottomCards: [],
            isMainFixed: false,
            mainCallDeadline: Date.now() + 100000,
            counterMainDeadline: null,
            mainCalled: false,
            bankerTeam: 1, 
            bottomDealer: null,
            lastWinningTeam: null,
            currentPlayer: null,  // 当前出牌玩家
            firstPlayerInRound: null, // 当前轮次首个出牌玩家
            roundCards: [],  // 当前轮次出的牌
            roundNumber: 1   // 轮次计数
        };

        // --- 发牌函数修改 ---
        let humanCardsDealtCount = 0; // 追踪给玩家补充了多少牌
        function dealPlayingTestCards(currentRound = 0) {
            const totalRounds = 26;  // 每人26张牌
            // console.log(`Dealing playing test round ${currentRound + 1}/${totalRounds}`);

            // 叫主逻辑保持不变
            if (currentRound === 2) { // 在发第三张牌后，让对家（机器人）叫主
                 setTimeout(() => {
                    const partnerIndex = 2; // 对家位置
                    const botId = gameState.players[partnerIndex].id;
                    
                    if (gameState && gameState.preGameState.canCallMain && !gameState.mainCalled) {
                        console.log('机器人对家叫主: HEARTS');
                        gameState.mainSuit = 'HEARTS'; // 确保主牌是红桃
                        gameState.mainCaller = botId;
                        gameState.mainCards = { joker: 'BIG', pair: { suit: 'HEARTS', value: 'A' } };
                        gameState.mainCalled = true;
                         // ... (后续状态更新逻辑保持不变) ...
                         io.to(roomId).emit('mainCalled', {
                             mainSuit: gameState.mainSuit,
                             mainCaller: gameState.mainCaller,
                             mainCards: gameState.mainCards
                         });
                         gameState.preGameState = { ...gameState.preGameState, canCallMain: false, canStealMain: true };
                         io.to(roomId).emit('updateGameState', { phase: 'pregame', preGameState: gameState.preGameState });
                    }
                }, 500);
            }

            // 判断是否所有牌都发完
            // 结束条件：所有轮次完成即可
            if (currentRound >= totalRounds) {
                console.log('所有玩家牌已处理完毕');
                gameState.preGameState.isDealing = false;
                
                // 剩余的牌作为底牌 (应该正好是4张)
                gameState.bottomCards = gameState.deck;
                console.log(`设置底牌 (${gameState.bottomCards.length} 张):`, gameState.bottomCards);
                if (gameState.bottomCards.length !== 4) {
                    console.error("错误：底牌数量不是4张！请检查牌数计算。");
                }
                
                // --- 进入后续阶段的逻辑 (叫主/反主/粘牌/抠底) 保持不变 ---
                // 注意：这里依赖 gameState.mainCalled，由上面的叫主逻辑设置
                if (gameState.mainCalled /* && gameState.preGameState.stealMainDelayed */) { // 简化条件
                    console.log('设置反主截止时间');
                    const stealMainDeadline = Date.now() + 3000;
                    gameState.preGameState.stealMainDeadline = stealMainDeadline;
                    // gameState.preGameState.stealMainDelayed = false; // 可能不需要这个标志了
                    
                    io.to(roomId).emit('updateGameState', { phase: 'pregame', preGameState: gameState.preGameState });
                    io.to(roomId).emit('mainCalled', { /* ... payload ... */ stealMainDeadline });

                    // 3秒后进入粘牌阶段
                    setTimeout(() => {
                        console.log('进入粘牌阶段');
                        gameState.phase = 'stickPhase';
                        // ... (粘牌状态更新) ...
                        io.to(roomId).emit('updateGameState', { phase: 'stickPhase', preGameState: gameState.preGameState });

                        // 3秒后进入抠底阶段
                        setTimeout(() => {
                            console.log('进入抠底阶段');
                            gameState.bottomDealer = socket.id; // 设置抠底玩家为自己
                            gameState.phase = 'bottomDeal';
                             // ... (抠底状态更新) ...
                            
                            const bottomDealerPlayer = gameState.players.find(p => p.id === gameState.bottomDealer);
                            if (bottomDealerPlayer) {
                                console.log('抠底前玩家手牌数量:', bottomDealerPlayer.cards.length); // 应该是 26 张
                                // 底牌处理逻辑 (保持不变，会自动加入预设手牌中)
                                bottomDealerPlayer.cards = bottomDealerPlayer.cards.filter(card => !card.isFromBottom);
                                const markedBottomCards = gameState.bottomCards.map(card => ({ ...card, isFromBottom: true, bottomId: `${card.suit}-${card.value}` }));
                                bottomDealerPlayer.cards = [...bottomDealerPlayer.cards, ...markedBottomCards];
                                console.log('加入底牌后玩家手牌数量:', bottomDealerPlayer.cards.length);
                                io.to(gameState.bottomDealer).emit('updatePlayerCards', bottomDealerPlayer.cards); // 发送最终手牌
                            }
                            
                            socket.emit('receiveBottomCards', { bottomCards: gameState.bottomCards });
                            io.to(roomId).emit('updateGameState', { phase: 'bottomDeal', bottomDealer: gameState.bottomDealer, preGameState: gameState.preGameState });

                            // --- 抠底完成后的出牌阶段处理 (保持不变) ---
                            const originalListener = socket.listeners('confirmBottomDeal').find(listener => true);
                            if (originalListener) socket.removeListener('confirmBottomDeal', originalListener);
                            
                            socket.once('confirmBottomDeal', (data) => {
                                if (originalListener) originalListener(data); // 执行服务器原始抠底逻辑
                                setTimeout(() => {
                                    console.log('进入出牌阶段 (抠底后)');
                                    gameState.phase = 'playing';
                                    gameState.currentPlayer = gameState.bottomDealer; // 设置当前玩家为自己
                                    gameState.firstPlayerInRound = gameState.bottomDealer; // 设置自己为首轮出牌者
                                    
                                    io.to(roomId).emit('gamePhaseChanged', { phase: 'playing', currentPlayer: gameState.currentPlayer, bottomDealer: gameState.bottomDealer });
                                    io.to(roomId).emit('playerTurn', { player: gameState.currentPlayer, playerName: "你的回合", isFirstPlayer: true }); // 确保通知自己是第一个出牌
                                }, 1000);
                            });
                        }, 3000); // 粘牌->抠底
                    }, 3000); // 反主->粘牌
                } else {
                    // 如果没有叫主，则可能是其他流程或直接结束（根据游戏规则）
                    console.log("未叫主，发牌结束后流程中止");
                }
                return; // 发牌结束
            }

            // --- 按轮次给每个玩家处理牌 ---
            gameState.players.forEach((player, index) => {
                let card = null; // 本轮要处理的牌
                
                if (player.isBot) {
                    // 机器人逻辑: 使用预设或从牌堆拿
                    if (index === 2 && currentRound < botCards.length) {
                        card = botCards[currentRound]; // 用预设牌
                    } else {
                        card = gameState.deck.pop(); // 从牌堆拿
                    }
                    if (card) {
                        player.cards.push(card); // 加入机器人手牌
                    }
                } else if (player.id === socket.id) {
                    // 玩家逻辑: 只补充需要的牌
                    if (humanCardsDealtCount < cardsToDealToPlayer) {
                        card = gameState.deck.pop(); // 从牌堆拿补充牌
                        if (card) {
                            player.cards.push(card); // 加入玩家手牌
                            humanCardsDealtCount++;
                            // 给玩家发送这张补充牌的信息
                            io.to(player.id).emit('receiveCard', {
                                card,
                                cardIndex: currentRound, // 使用轮次作为索引，客户端需要能处理合并
                                totalCards: totalRounds 
                            });
                        }
                    }
                    // 如果补充牌已发够，则本轮跳过给玩家发牌
                }
            });

            // 广播发牌进度 (不变)
            io.to(roomId).emit('dealingProgress', { currentRound: currentRound + 1, totalRounds });

            // 继续下一轮发牌 (不变)
            setTimeout(() => dealPlayingTestCards(currentRound + 1), 100); 
        }

        // 存储游戏状态和房间信息 (保持不变)
        games.set(roomId, gameState);
        rooms.set(roomId, room);
        
        socket.join(roomId);
        socket.emit('joinRoomSuccess', roomId);
        io.to(roomId).emit('roomInfo', room);
        
        socket.emit('testGameCreated', { 
            roomId,
            message: '出牌测试：已为你预设手牌，对家叫红桃主，你抠底后请测试领出牌型。'
        });
        
        // 开始游戏 (保持不变)
        setTimeout(() => {
            console.log('开始出牌测试游戏...');
            io.to(roomId).emit('gameStart');
            setTimeout(() => {
                dealPlayingTestCards(0); // 开始发牌流程
            }, 500);
        }, 1000);
    });
};