// 创建跟牌测试游戏

// 定义对家机器人的出牌序列
// 注意：这些牌必须是下面 botPartnerCards 中实际分配给对家机器人的牌
const controlledBotLeads = [
    // 黑桃对 66
    [{ suit: 'SPADES', value: '6' }, { suit: 'SPADES', value: '6' }],
    // 黑桃连对 7788
    [{ suit: 'SPADES', value: '7' }, { suit: 'SPADES', value: '7' },
    { suit: 'SPADES', value: '8' }, { suit: 'SPADES', value: '8' }],
    // 草花 6 7 8 99 10 (测试雨)
    [{ suit: 'CLUBS', value: '6' }, { suit: 'CLUBS', value: '7' }, 
    { suit: 'CLUBS', value: '8' }, { suit: 'CLUBS', value: '9' }, 
    { suit: 'CLUBS', value: '9' }, { suit: 'CLUBS', value: '10' }],
    // 一张 3 （测试主牌）
    [{ suit: 'SPADES', value: '3' }],
    // 四种花色的 2 (测试闪)
    [{ suit: 'HEARTS', value: '2' }, { suit: 'SPADES', value: '2' },
    { suit: 'DIAMONDS', value: '2' }, { suit: 'CLUBS', value: '2' }],
    // 四种花色5加上红桃5 (测试震)
    [{ suit: 'SPADES', value: '5' }, { suit: 'DIAMONDS', value: '5' },
    { suit: 'CLUBS', value: '5' }, { suit: 'HEARTS', value: '5' },
    { suit: 'HEARTS', value: '5' }]
];

module.exports = function(socket, io, games, rooms, utils) {
    const { createDeck, shuffleDeck, handleBotPlay, endRound, isMainCard } = utils;

    // 监听 'createFollowTestGame' 事件
    socket.on('createFollowTestGame', () => {
        console.log(`创建跟牌测试房间`);
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

        // 预设玩家手牌，用于叫主
        const presetPlayerHand = [
            { suit: 'JOKER', value: 'BIG' },  // 大王
            { suit: 'HEARTS', value: 'A' },    // 红桃A
            { suit: 'HEARTS', value: 'A' }     // 红桃A
        ];
        const cardsToDealToPlayer = 26 - presetPlayerHand.length; // 计算需要补充多少张牌

        // 预设对家机器人手牌，用于跟牌测试
        // 确保 controlledBotLeads 中的牌都来源于这里
        const botPartnerCards = [
            // 黑桃对 66
            { suit: 'SPADES', value: '6' }, { suit: 'SPADES', value: '6' },
            // 黑桃连对 7788
            { suit: 'SPADES', value: '7' }, { suit: 'SPADES', value: '7' },
            { suit: 'SPADES', value: '8' }, { suit: 'SPADES', value: '8' },
            // 草花 6 7 8 99 10 (测试雨)
            { suit: 'CLUBS', value: '6' }, { suit: 'CLUBS', value: '7' }, 
            { suit: 'CLUBS', value: '8' }, { suit: 'CLUBS', value: '9' }, 
            { suit: 'CLUBS', value: '9' }, { suit: 'CLUBS', value: '10' },
            // 一张 3 （测试主牌）
            { suit: 'SPADES', value: '3' },
            // 四种花色的 2 (测试闪)
            { suit: 'HEARTS', value: '2' }, { suit: 'SPADES', value: '2' },
            { suit: 'DIAMONDS', value: '2' }, { suit: 'CLUBS', value: '2' },
            // 四种花色5加上红桃5 (测试震)
            { suit: 'SPADES', value: '5' }, { suit: 'DIAMONDS', value: '5' },
            { suit: 'CLUBS', value: '5' }, { suit: 'HEARTS', value: '5' },
            { suit: 'HEARTS', value: '5' }
        ];

        // 创建牌堆 从牌堆中移除 预设给玩家的牌 和 预设给机器人的牌
        const fullDeck = createDeck();
        const cardsToRemove = [...presetPlayerHand, ...botPartnerCards];
        const deck = [...fullDeck];
        cardsToRemove.forEach(cardToRemove => {
            const cardIndex = deck.findIndex(card => 
                card.suit === cardToRemove.suit && card.value === cardToRemove.value
            );
            deck.splice(cardIndex, 1);
        });

        // 洗牌
        const shuffledDeck = shuffleDeck(deck);

        // 创建游戏状态
        const gameState = {
            deck: shuffledDeck,
            players: players.map(p => {
                // 分配预设手牌给当前玩家
                if (p.id === socket.id) {
                    return {
                        ...p,
                        cards: [],
                        isDealer: false
                    };
                }
                // 机器人先给空手牌，后面发
                return {
                    ...p,
                    cards: [],
                    isDealer: false
                };
            }),
            currentTurn: null,
            mainSuit: null,
            mainCaller: null,
            mainCards: null,
            phase: 'pregame',
            preGameState: {
                isDealing: true,
                canCallMain: true,
                commonMain: '2'
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
            currentPlayer: null,
            firstPlayerInRound: null,
            roundCards: [],
            roundNumber: 1,
            // testConfig 将在下面添加
        };

        // --- 添加 testConfig ---
        // 首先确定玩家 (socket.id) 在 players 数组中的索引
        const humanPlayerIndex = gameState.players.findIndex(p => p.id === socket.id);
        // 对家机器人的索引是 (玩家索引 + 2) % 4
        const partnerBotIndexInPlayersArray = (humanPlayerIndex + 2) % gameState.players.length;
        const controlledBotId = gameState.players[partnerBotIndexInPlayersArray].id;

        gameState.testConfig = {
            controlledBotId: controlledBotId,
            predefinedLeads: controlledBotLeads,
            currentLeadIndex: 0
        };
        console.log(`[测试配置] 受控机器人ID: ${controlledBotId}, 预设出牌数量: ${controlledBotLeads.length}`);
        // --- testConfig 添加完毕 ---
        
        // 发牌
        function dealPlayingTestCards(currentRound = 0) {
            const totalRounds = 26;  // 每人26张牌

            // 叫主
            if (currentRound === 2) { // 在发第三张牌后，让玩家叫主
                setTimeout(() => {
                    
                    if (gameState && gameState.preGameState.canCallMain && !gameState.mainCalled) {
                        console.log(`玩家 ${socket.id} 自动叫主: HEARTS`);
                        gameState.mainSuit = 'HEARTS'; // 主牌是红桃
                        gameState.mainCaller = socket.id; // 玩家的 ID
                        gameState.mainCards = { joker: 'BIG', pair: { suit: 'HEARTS', value: 'A' } }; // 叫主的牌保持不变
                        gameState.mainCalled = true;
                         
                        io.to(roomId).emit('mainCalled', {
                            mainSuit: gameState.mainSuit,
                            mainCaller: gameState.mainCaller,
                            mainCards: gameState.mainCards
                        });
                        gameState.preGameState = { ...gameState.preGameState, canCallMain: false, canStealMain: true };
                        io.to(roomId).emit('updateGameState', { phase: 'pregame', preGameState: gameState.preGameState });
                    }
                }, 500); // 延迟500ms叫主
            }

            if (currentRound >= totalRounds) {
                gameState.preGameState.isDealing = false;
                
                // 剩余4张牌作为底牌
                gameState.bottomCards = gameState.deck;
                
                // 进入反主/粘牌/抠底
                if (gameState.mainCalled) {
                    // 反主
                    const stealMainDeadline = Date.now() + 3000;
                    gameState.preGameState.stealMainDeadline = stealMainDeadline;
                    
                    io.to(roomId).emit('updateGameState', { phase: 'pregame', preGameState: gameState.preGameState });
                    io.to(roomId).emit('mainCalled', {stealMainDeadline });

                    // 粘牌
                    setTimeout(() => {
                        gameState.phase = 'stickPhase';
                        io.to(roomId).emit('updateGameState', { phase: 'stickPhase', preGameState: gameState.preGameState });

                        // 抠底
                        setTimeout(() => {
                            const mainCallerId = gameState.mainCaller; // 在此测试中，这应该是 socket.id
                            const mainCallerPlayerObj = gameState.players.find(p => p.id === mainCallerId);
                            const mainCallerIndex = gameState.players.indexOf(mainCallerPlayerObj);
                            const partnerRobotIndex = (mainCallerIndex + 2) % 4; // 对家机器人的索引是 (玩家索引 + 2) % 4
                            const bottomDealerId = gameState.players[partnerRobotIndex].id;
                            const bottomDealingRobot = gameState.players.find(p => p.id === bottomDealerId);

                            const robotName = bottomDealingRobot ? bottomDealingRobot.name : `机器人${bottomDealerId.slice(-4)}`;
                            console.log(`进入抠底阶段。叫主方 ${mainCallerId} (玩家) 的对家 ${robotName} (${bottomDealerId}) 将自动处理底牌。`);
                            
                            gameState.bottomDealer = bottomDealerId; // 设置机器人为抠底方
                            gameState.phase = 'bottomDeal';
                            
                            // 通知所有客户端游戏阶段和当前的抠底方
                            io.to(roomId).emit('updateGameState', { 
                                phase: 'bottomDeal', 
                                bottomDealer: gameState.bottomDealer, 
                                preGameState: gameState.preGameState 
                            });
                            
                            // 机器人自动将初始底牌原样放回
                            
                            // 广播最终确认的底牌信息
                            io.to(roomId).emit('bottomCardsConfirmed', { 
                                bottomCards: gameState.bottomCards, // 这些是最终埋到底下的牌
                                dealer: bottomDealerId 
                            });
                            
                            // 模拟机器人抠底完成并进入出牌阶段
                            setTimeout(() => {
                                console.log(`${robotName} (${bottomDealerId}) 抠底完成，进入出牌阶段。`);
                                gameState.phase = 'playing';
                                gameState.currentPlayer = gameState.bottomDealer; // 抠底的机器人先出牌
                                gameState.firstPlayerInRound = gameState.bottomDealer;
                                
                                // 广播游戏阶段变更
                                io.to(roomId).emit('gamePhaseChanged', { 
                                    phase: 'playing', 
                                    currentPlayer: gameState.currentPlayer, 
                                    bottomDealer: gameState.bottomDealer // 确认抠底方
                                });
                                
                                // 通知轮到机器人出牌
                                io.to(roomId).emit('playerTurn', { 
                                    player: gameState.currentPlayer, 
                                    playerName: `${robotName} 的回合`, 
                                    isFirstPlayer: true 
                                });
                                
                                console.log(`[服务器 ${roomId}] (跟牌测试) 确认 roomInfo 已在游戏开始时发送。`);
                            }, 1000); // 短暂延迟模拟操作

                        }, 3000); // 粘牌->抠底 的延迟
                    }, 3000); // 反主->粘牌 的延迟
                } else {
                    // 如果没有叫主，则可能是其他流程或直接结束（根据游戏规则）
                    console.log("未叫主，发牌结束后流程中止");
                }
                return; // 发牌结束
            }

            // 按轮次给每个玩家处理牌
            gameState.players.forEach((player, index) => {
                let card = null; // 本轮要处理的牌
                
                if (player.isBot) {
                    // 机器人逻辑: 使用预设或从牌堆拿
                    if (index === 2 && currentRound < botPartnerCards.length) {
                        card = botPartnerCards[currentRound]; // 用预设牌
                    } else {
                        card = gameState.deck.pop(); // 从牌堆拿
                    }
                    if (card) {
                        player.cards.push(card); // 加入机器人手牌
                    }
                } else if (player.id === socket.id) {
                    // 玩家逻辑: 只补充需要的牌
                    if (currentRound < presetPlayerHand.length) {
                        card = presetPlayerHand[currentRound]; // 从预设牌中取牌
                    } else {
                        card = gameState.deck.pop(); // 从牌堆拿补充牌
                    }
                    if (card) {
                        player.cards.push(card); // 加入玩家手牌
                        io.to(player.id).emit('receiveCard', {
                            card,
                            cardIndex: currentRound, // 使用轮次作为索引，客户端需要能处理合并
                            totalCards: totalRounds 
                        });
                    }
                }
            });

            // 广播发牌进度
            io.to(roomId).emit('dealingProgress', { currentRound: currentRound + 1, totalRounds });

            // 继续下一轮发牌
            setTimeout(() => dealPlayingTestCards(currentRound + 1), 100); 
        }

        // 存储游戏状态和房间信息
        games.set(roomId, gameState);
        rooms.set(roomId, room);
        
        socket.join(roomId);
        socket.emit('joinRoomSuccess', roomId);
        io.to(roomId).emit('roomInfo', room);
        
        socket.emit('testGameCreated', { 
            roomId,
            message: '跟牌测试：已为你预设手牌，你叫红桃主，机器人出牌后请测试跟牌。'
        });

        // 开始游戏
        setTimeout(() => {
            console.log('开始跟牌测试游戏...');
            // 发送游戏开始事件
            io.to(roomId).emit('gameStart'); 
            
            // --- 添加的代码：发送包含最终玩家信息的 roomInfo ---
            // 从 gameState 获取最新的玩家列表
            const finalPlayers = gameState.players.map(p => ({ 
                id: p.id, 
                name: p.name, 
                ready: p.ready, // 可以包含其他客户端需要的信息
                isBot: p.isBot 
            }));
            // 构建 roomInfo 数据结构
            const roomDataForClient = { 
                id: roomId, 
                players: finalPlayers 
            };
            console.log('发送最终的 roomInfo 给客户端:', roomDataForClient);
            io.to(roomId).emit('roomInfo', roomDataForClient);
            // --- 添加的代码结束 ---

            // 开始发牌流程
            setTimeout(() => {
                dealPlayingTestCards(0); 
            }, 500);
        }, 1000);
        
    });
};
