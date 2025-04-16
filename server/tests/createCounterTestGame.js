module.exports = function(socket, io, games, rooms, utils) {
    const { createDeck, shuffleDeck, handleBotPlay, endRound, getPlayerTeam, determineBottomDealer } = utils;

    // 创建反主测试游戏
    socket.on('createCounterTestGame', () => {
        console.log('Creating counter main test game...');
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

        // 预先准备机器人的牌（用于叫主）
        const botCards = [
            { suit: 'JOKER', value: 'BIG' },  // 大王
            { suit: 'HEARTS', value: 'A' },    // 红桃A
            { suit: 'HEARTS', value: 'A' }     // 红桃A
        ];
        
        // 预先准备玩家的牌（用于反主）
        const playerCards = [
            { suit: 'JOKER', value: 'SMALL' },  // 小王
            { suit: 'JOKER', value: 'SMALL' },  // 小王
            { suit: 'SPADES', value: 'A' },     // 黑桃A
            { suit: 'SPADES', value: 'A' }      // 黑桃A
        ];
        
        // 从牌堆中移除这些已经分配的牌
        const remainingDeck = deck.filter(card => 
            !(botCards.some(bc => bc.suit === card.suit && bc.value === card.value)) &&
            !(playerCards.some(pc => pc.suit === card.suit && pc.value === pc.value))
        );

        function dealCounterTestCards(currentRound = 0) {
            const totalRounds = 26;
            console.log(`Dealing counter test round ${currentRound + 1}/${totalRounds}`);

            // 第一张牌时，设置初始状态
            if (currentRound === 0) {
                console.log('First counter test card dealt, can start calling main');
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
                        preGameState: gameState.preGameState
                    });
                    
                    io.to(roomId).emit('mainCalled', {
                        mainSuit: gameState.mainSuit,
                        mainCaller: gameState.mainCaller,
                        mainCards: gameState.mainCards,
                        stealMainDeadline: stealMainDeadline
                    });
                }
                
                // 更新游戏状态
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: gameState.preGameState
                });
                
                // 设置叫主截止时间（发牌结束后10秒）
                const callMainDeadline = Date.now() + 10000; // 10秒而不是100秒
                gameState.preGameState.callMainDeadline = callMainDeadline;
                
                // 通知客户端
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: gameState.preGameState
                });
                
                return;
            }

            // 给真实玩家发牌
            if (currentRound < playerCards.length) {
                // 发送预设的牌
                io.to(socket.id).emit('receiveCard', {
                    card: playerCards[currentRound],
                    cardIndex: currentRound,
                    totalCards: totalRounds
                });
                gameState.players[0].cards[currentRound] = playerCards[currentRound];
            } else {
                // 发送随机牌
                const card = remainingDeck.pop();
                io.to(socket.id).emit('receiveCard', {
                    card,
                    cardIndex: currentRound,
                    totalCards: totalRounds
                });
                gameState.players[0].cards[currentRound] = card;
            }

            // 给机器人发牌
            for (let i = 1; i < 4; i++) {
                if (i === 1 && currentRound < botCards.length) {
                    // 给第一个机器人发预设的牌（用于叫主）
                    gameState.players[i].cards[currentRound] = botCards[currentRound];
                } else {
                    // 给其他机器人发随机牌
                    const card = remainingDeck.pop();
                    gameState.players[i].cards[currentRound] = card;
                }
            }

            // 广播发牌进度
            io.to(roomId).emit('dealingProgress', {
                currentRound: currentRound + 1,
                totalRounds
            });

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
                    }
                }, 500);
            }

            // 继续下一轮发牌
            setTimeout(() => {
                dealCounterTestCards(currentRound + 1);
            }, 1000);
        }

        // 存储游戏状态
        games.set(roomId, gameState);
        
        // 确保客户端先收到房间信息
        socket.emit('joinRoomSuccess', roomId);
        io.to(roomId).emit('roomInfo', room);
        
        // 发送测试游戏创建成功消息
        socket.emit('testGameCreated', { 
            roomId,
            message: '反主测试：机器人将收到一张大王和两张红桃A用于叫主，您将收到两张小王和两张黑桃A用于反主'
        });
        
        // 开始游戏和发牌
        setTimeout(() => {
            console.log('Starting counter test game...');
            io.to(roomId).emit('gameStart');
            
            // 使用新的发牌函数
            setTimeout(() => {
                dealCounterTestCards(0);
            }, 1000);
        }, 2000);
    });
};