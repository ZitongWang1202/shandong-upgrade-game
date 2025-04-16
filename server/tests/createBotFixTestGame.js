module.exports = function(socket, io, games, rooms, utils) {
    const { createDeck, shuffleDeck, handleBotPlay, endRound, getPlayerTeam, determineBottomDealer } = utils;

    // 创建机器人加固测试游戏
    socket.on('createBotFixTestGame', () => {
        console.log('Creating bot fix main test game...');
        const roomId = Math.random().toString(36).slice(2, 8);
        
        // 添加真实玩家（当前连接的用户）
        const players = [{
            id: socket.id,
            ready: true,  // 自动准备
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
        const room = {
            id: roomId,
            players: players
        };
        rooms.set(roomId, room);
        
        socket.join(roomId);
        
        // 创建游戏状态
        const deck = shuffleDeck(createDeck());
        const gameState = {
            deck: deck,
            players: players.map(p => ({
                ...p,
                cards: [],
                isDealer: false
            })),
            currentTurn: null,
            mainSuit: null,
            mainCaller: null,
            mainCards: null,
            phase: 'pregame',
            preGameState: {
                isDealing: true,
                canCallMain: true
            },
            currentRound: [],
            bottomCards: [],
            isMainFixed: false,
            mainCallDeadline: Date.now() + 100000,
            counterMainDeadline: null,
            mainCalled: false,
            commonMain: '2',  // 初始常主为2
            dealerTeam: null,        // 庄家队伍 [player1.id, player3.id] 或 [player2.id, player4.id]
            bottomDealer: null,       // 抠底的玩家
            lastWinningTeam: null,   // 上一局赢的队伍
        };

        // 预先准备机器人的牌（用于叫主和加固）
        const botCards = [
            { suit: 'JOKER', value: 'BIG' },  // 大王1
            { suit: 'JOKER', value: 'BIG' },  // 大王2
            { suit: 'HEARTS', value: 'A' },   // 红桃A1
            { suit: 'HEARTS', value: 'A' }    // 红桃A2
        ];
        
        // 从牌堆中移除这些已经分配的牌
        const remainingDeck = deck.filter(card => 
            !(botCards.some(bc => bc.suit === card.suit && bc.value === card.value))
        );

        function dealBotFixTestCards(currentRound = 0) {
            const totalRounds = 26;
            console.log(`Dealing bot fix test round ${currentRound + 1}/${totalRounds}`);

            // 第一张牌时，设置初始状态
            if (currentRound === 0) {
                console.log('First bot fix test card dealt, can start calling main');
                gameState.preGameState = {
                    isDealing: true,
                    canCallMain: true,
                    commonMain: gameState.commonMain
                };
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: gameState.preGameState
                });
            }

            // 在发第三张牌后（确保机器人已经有大王和两张红桃A），让机器人叫主
            if (currentRound === 2) {
                setTimeout(() => {
                    // 获取第一个机器人的ID
                    const botId = gameState.players[1].id;
                    
                    // 模拟机器人叫主
                    if (gameState && gameState.preGameState.canCallMain && !gameState.mainCalled) {
                        console.log('Bot is calling main');
                        
                        // 更新游戏状态
                        gameState.mainSuit = 'HEARTS'; // 红桃
                        gameState.mainCaller = botId;
                        gameState.mainCards = {
                            joker: 'BIG',
                            pair: { suit: 'HEARTS', value: 'A' }
                        };
                        gameState.mainCalled = true;
                        
                        // 如果在发牌时叫主，设置延迟标志
                        if (gameState.preGameState.isDealing) {
                            gameState.preGameState.stealMainDelayed = true;
                            
                            // 通知所有玩家主花色已经被叫出
                            io.to(roomId).emit('mainCalled', {
                                mainSuit: 'HEARTS',
                                mainCaller: botId,
                                mainCards: {
                                    joker: 'BIG',
                                    pair: { suit: 'HEARTS', value: 'A' }
                                }
                            });
                        }
                        
                        // 更新 preGameState
                        gameState.preGameState = {
                            ...gameState.preGameState,
                            canCallMain: false,
                            canStealMain: true
                        };
                        
                        // 通知所有玩家游戏状态已更新
                        io.to(roomId).emit('updateGameState', {
                            phase: 'pregame',
                            preGameState: {
                                ...gameState.preGameState,
                                commonMain: gameState.commonMain
                            }
                        });
                        
                        // 添加机器人加固逻辑
                        setTimeout(() => {
                            console.log('Bot is fixing main');
                            
                            // 机器人加固
                            gameState.isMainFixed = true;
                            
                            // 通知所有玩家主已加固
                            io.to(roomId).emit('mainFixed', {
                                mainSuit: gameState.mainSuit,
                                mainCaller: gameState.mainCaller,
                                mainCards: gameState.mainCards
                            });
                            
                            // 更新游戏状态
                            gameState.preGameState = {
                                ...gameState.preGameState,
                                canStealMain: false,  // 加固后不能反主
                                canFixMain: false     // 已经加固，不能再加固
                            };
                            
                            // 通知所有玩家游戏状态已更新
                            io.to(roomId).emit('updateGameState', {
                                phase: 'pregame',
                                preGameState: gameState.preGameState
                            });
                            
                            // 在发牌结束后，跳过反主阶段，直接进入抠底阶段
                            if (!gameState.preGameState.isDealing) {
                                // 如果发牌已经结束，直接进入抠底阶段
                                gameState.bottomDealer = determineBottomDealer(gameState);
                                const bottomDealer = gameState.bottomDealer;
                                
                                gameState.phase = 'bottomDeal';
                                io.to(roomId).emit('updateGameState', {
                                    phase: 'bottomDeal',
                                    bottomDealer: bottomDealer
                                });
                            }
                        }, 5000); // 5秒后加固
                    }
                }, 2000); // 延迟2秒叫主
            }

            if (currentRound >= totalRounds) {
                console.log('All cards dealt');
                gameState.preGameState.isDealing = false;
                
                // 如果在发牌过程中有人叫主，设置反主截止时间
                if (gameState.mainCalled && gameState.preGameState.stealMainDelayed) {
                    console.log('Setting steal main deadline after dealing completed');
                    const stealMainDeadline = Date.now() + 10000;
                    gameState.preGameState.stealMainDeadline = stealMainDeadline;
                    gameState.preGameState.stealMainDelayed = false;
                    
                    io.to(roomId).emit('updateGameState', {
                        phase: 'pregame',
                        preGameState: {
                            ...gameState.preGameState,
                            commonMain: gameState.commonMain
                        }
                    });
                    
                    // 通知所有玩家主牌已经被叫出
                    io.to(roomId).emit('mainCalled', {
                        mainSuit: gameState.mainSuit,
                        mainCaller: gameState.mainCaller,
                        mainCards: gameState.mainCards,
                        stealMainDeadline: stealMainDeadline
                    });
                }
                
                // 既然已经发完牌，直接设置游戏状态让机器人加固
                if (gameState.mainCalled && !gameState.isMainFixed) {
                    setTimeout(() => {
                        console.log('Bot is fixing main after all cards dealt');
                        
                        // 机器人加固
                        gameState.isMainFixed = true;
                        
                        // 通知所有玩家主已加固
                        io.to(roomId).emit('mainFixed', {
                            mainSuit: gameState.mainSuit,
                            mainCaller: gameState.mainCaller,
                            mainCards: gameState.mainCards
                        });
                        
                        // 更新游戏状态
                        gameState.preGameState = {
                            ...gameState.preGameState,
                            canStealMain: false,  // 加固后不能反主
                            canFixMain: false     // 已经加固，不能再加固
                        };
                        
                        // 通知所有玩家游戏状态已更新
                        io.to(roomId).emit('updateGameState', {
                            phase: 'pregame',
                            preGameState: gameState.preGameState
                        });
                        
                        // 然后设置抠底
                        setTimeout(() => {
                            console.log('Setting bottom dealer after main fixed');
                            
                            // 确定抠底玩家
                            gameState.bottomDealer = determineBottomDealer(gameState);
                            const bottomDealer = gameState.bottomDealer;
                            
                            // 进入抠底阶段
                            gameState.phase = 'bottomDeal';
                            gameState.preGameState = {
                                ...gameState.preGameState,
                                bottomDealDeadline: Date.now() + 20000  // 给20秒抠底时间
                            };
                            
                            io.to(roomId).emit('updateGameState', {
                                phase: 'bottomDeal',
                                bottomDealer: bottomDealer,
                                preGameState: gameState.preGameState
                            });
                        }, 3000);
                    }, 3000);
                }
                
                return;
            }

            // 给所有玩家发牌
            gameState.players.forEach((player, index) => {
                let card;
                
                // 给第一个机器人特定的牌
                if (index === 1 && currentRound < botCards.length) {
                    card = botCards[currentRound];
                } else {
                    card = remainingDeck.pop();
                }
                
                if (card) {
                    player.cards.push(card);
                    io.to(player.id).emit('receiveCard', {
                        card,
                        cardIndex: currentRound,
                        totalCards: totalRounds
                    });
                }
            });

            // 广播发牌进度
            io.to(roomId).emit('dealingProgress', {
                currentRound: currentRound + 1,
                totalRounds
            });

            // 继续下一轮发牌
            setTimeout(() => {
                dealBotFixTestCards(currentRound + 1);
            }, 100);
        }

        // 存储游戏状态和房间信息
        games.set(roomId, gameState);
        rooms.set(roomId, room);
        
        socket.emit('joinRoomSuccess', roomId);
        io.to(roomId).emit('roomInfo', room);
        
        socket.emit('testGameCreated', { 
            roomId,
            message: '机器人加固测试：机器人将使用两张大王和红桃A叫主并加固'
        });
        
        // 开始游戏和发牌
        setTimeout(() => {
            console.log('Starting bot fix test game...');
            io.to(roomId).emit('gameStart');
            
            setTimeout(() => {
                dealBotFixTestCards(0);
            }, 500);
        }, 1000);
    });
};