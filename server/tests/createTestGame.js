// 创建一键式测试游戏
module.exports = function (socket, io, games, rooms, utils) {
    const { createDeck, shuffleDeck, handleBotPlay, endRound, getPlayerTeam, determineBottomDealer, exchangeCards } = utils;

    socket.on('createTestGame', () => {
        console.log(`[${socket.id}] 请求创建一键式测试房间`);
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

        // 创建牌堆 定义预设手牌 
        const presetPlayerHand = [];
        const cardsToDealToPlayer = 26 - presetPlayerHand.length; // 计算需要补充多少张牌
        const botCards = [];

        const fullDeck = createDeck();
        const cardsToRemove = [...presetPlayerHand, ...botCards];
        const deck = [...fullDeck];

        cardsToRemove.forEach(cardToRemove => {
            const cardIndex = deck.findIndex(card =>
                card.suit === cardToRemove.suit && card.value === cardToRemove.value
            );
            if (cardIndex > -1) deck.splice(cardIndex, 1);
        });
        const shuffledDeck = shuffleDeck(deck);

        // 创建游戏状态
        const gameState = {
            deck: shuffledDeck,
            players: players.map(p => ({
                ...p,
                cards: [],
                isDealer: false
            })),
            currentTurn: null,
            phase: 'pregame',
            preGameState: {
                commonMain: '2',
                isDealing: true,
                dealingProgress: 0,

                canCallMain: true,
                callMainDeadline: null,
                callMainTimeLeft: null,
                mainCalled: false,
                mainSuit: null,
                mainCaller: null,
                mainCards: null,
                isMainCaller: false,

                canStealMain: false,
                stealMainDeadline: null,
                stealMainTimeLeft: null,
                isMainFixed: false,
                hasCounteredMain: false,

                canFixMain: false,
                canCounterMain: false,

                showFixButton: false,
                showCounterButton: false,
                counterJoker: null,
                counterPair: null,

                canStickMain: false,
                stickMainDeadline: null,
                stickMainTimeLeft: null,
                isStickPhase: false,
                hasStickCards: false,
                mainCallerCardsForSticking: null,
                selectedCardsForSticking: { commonMain: null, suitCards: [] },

                isBottomDealer: false,
                bottomCards: [],
                selectedBottomCards: [],
                bottomDealDeadline: null,
                bottomDealTimeLeft: null,
                cardsFromBottom: [],
                interactedBottomCards: []
            },
            currentRoundCards: [],
            dealerTeam: null,
            bottomDealer: null,
            lastWinningTeam: null,
        };

        // 存储游戏状态和房间信息
        games.set(roomId, gameState);
        rooms.set(roomId, room);

        socket.join(roomId);
        console.log(`[${socket.id}] 已创建测试房间 ${roomId} 并加入.`);

        // 通知客户端测试游戏已创建，让客户端知道可以预期 'gameStart' 事件
        socket.emit('testGameCreated', {
            roomId,
            message: '一键式测试已创建，即将开始游戏。'
        });

        // 直接发送 gameStart 事件以触发客户端导航到 GameLayout
        // 注意：这里用 io.to(roomId) 是因为 gameStart 可能需要通知房间内的所有客户端（尽管测试场景下通常只有一个真实用户）
        io.to(roomId).emit('gameStart');
        console.log(`[${socket.id}] 已发送 gameStart 给房间 ${roomId}. 等待 GameLayout 的 gameLayoutReadyForData 信号...`);

        // 等待 GameLayout 加载完毕并准备好接收数据
        socket.once('gameLayoutReadyForData', (gameLayoutReadyData) => {
            if (gameLayoutReadyData.roomId === roomId && socket.id === players[0].id /* Ensure it's the test initiator */) {
                console.log(`[${socket.id}] 收到来自 GameLayout (${socket.id}) 的 gameLayoutReadyForData 信号，房间 ${roomId}`);

                // 1. 发送包含最终玩家信息的 roomInfo 给发起请求的客户端 (socket.id)
                const finalPlayers = gameState.players.map(p => ({ 
                    id: p.id, name: p.name, ready: p.ready, isBot: p.isBot 
                }));
                const roomDataForClient = { id: roomId, players: finalPlayers };
                console.log(`[${socket.id}] 发送最终的 roomInfo 给客户端 ${socket.id}:`, roomDataForClient);
                io.to(socket.id).emit('roomInfo', roomDataForClient);

                // 2. 发送初始的 preGameState 给发起请求的客户端 (socket.id)
                console.log(`[${socket.id}] 发送初始的 preGameState 给客户端 ${socket.id}:`, gameState.preGameState);
                io.to(socket.id).emit('updateGameState', { 
                    phase: gameState.phase, 
                    preGameState: gameState.preGameState 
                });
                
                // 3. 短暂延迟后开始发牌
                setTimeout(() => {
                    dealPlayingTestCards(0); 
                }, 500); // 延迟确保客户端有足够时间处理 roomInfo 和 gameState

            } else {
                if (gameLayoutReadyData.roomId !== roomId) {
                    console.warn(`[${socket.id}] 收到的 gameLayoutReadyForData 的 roomId 不匹配: ${gameLayoutReadyData.roomId} vs ${roomId}`);
                }
                if (socket.id !== players[0].id) {
                     console.warn(`[${socket.id}] 收到的 gameLayoutReadyForData 来自非预期的 socket: ${socket.id} (预期: ${players[0].id})`);
                }
            }
        });

        // 发牌函数
        let humanCardsDealtCount = 0;
        function dealPlayingTestCards(currentRound = 0) {
            const totalRounds = 26;

            // 发牌结束
            if (currentRound >= totalRounds) {
                gameState.preGameState.isDealing = false;

                // 剩余的牌作为底牌 (正好是4张)
                gameState.bottomCards = gameState.deck;

                // 如果有人叫主 则进入后续阶段的逻辑 (叫主/反主/粘牌/抠底)
                if (gameState.mainCalled) {
                    const stealMainDeadline = Date.now() + 10000; // 反主（加固）倒计时
                    gameState.preGameState.stealMainDeadline = stealMainDeadline;

                    io.to(roomId).emit('updateGameState', { phase: 'pregame', preGameState: gameState.preGameState });
                    io.to(roomId).emit('mainCalled', { stealMainDeadline });

                    // 10秒后进入粘牌阶段
                    setTimeout(() => {
                        gameState.phase = 'stickPhase';
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
                                if (originalListener) originalListener(data);
                                setTimeout(() => {
                                    console.log('进入出牌阶段 (抠底后)');
                                    gameState.phase = 'playing';
                                    gameState.currentPlayer = gameState.bottomDealer;
                                    gameState.firstPlayerInRound = gameState.bottomDealer;

                                    // --- 确认这三个事件都被发送 ---
                                    console.log(`[服务器 ${roomId}] 准备发送 gamePhaseChanged:`, { phase: 'playing', currentPlayer: gameState.currentPlayer });
                                    io.to(roomId).emit('gamePhaseChanged', { phase: 'playing', currentPlayer: gameState.currentPlayer, bottomDealer: gameState.bottomDealer });

                                    console.log(`[服务器 ${roomId}] 准备发送 playerTurn:`, { player: gameState.currentPlayer, isFirstPlayer: true });
                                    io.to(roomId).emit('playerTurn', { player: gameState.currentPlayer, playerName: "你的回合", isFirstPlayer: true });

                                    console.log(`[服务器 ${roomId}] 确认 roomInfo 已在游戏开始时发送`);
                                }, 1000);
                            });
                        }, 10000); // 粘牌->抠底
                    }, 10000); // 反主->粘牌
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
            setTimeout(() => dealPlayingTestCards(currentRound + 1), 1000);
        }
    });
};