module.exports = function(socket, io, games, rooms, utils) {
    const { createDeck, shuffleDeck, handleBotPlay, endRound, getPlayerTeam, determineBottomDealer, exchangeCards } = utils;

    // 创建粘牌测试游戏
    socket.on('createStickTestGame', () => {
        console.log('Creating stick test game...');
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
        
        // 创建房间和游戏状态
        const room = { id: roomId, players: players };
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
        
        // 预先准备玩家的牌（用于粘牌）
        const playerCards = [
            { suit: 'JOKER', value: 'SMALL' },  // 小王
            { suit: 'HEARTS', value: '3' },     // 红桃3
            { suit: 'HEARTS', value: '6' },     // 红桃6
            { suit: 'HEARTS', value: '7' },     // 红桃7
            { suit: 'SPADES', value: '6' },     // 黑桃6
            { suit: 'SPADES', value: '6' },     // 黑桃6
            { suit: 'SPADES', value: '7' },     // 黑桃7
            { suit: 'SPADES', value: '7' }      // 黑桃7
        ];
        
        // 从牌堆中移除这些已经分配的牌
        const remainingDeck = deck.filter(card => 
            !(botCards.some(bc => bc.suit === card.suit && bc.value === card.value)) &&
            !(playerCards.some(pc => pc.suit === card.suit && pc.value === card.value))
        );

        function dealStickTestCards(currentRound = 0) {
            const totalRounds = 26;
            console.log(`Dealing stick test round ${currentRound + 1}/${totalRounds}`);

            // 第一张牌时，设置初始状态
            if (currentRound === 0) {
                console.log('First stick test card dealt, can start calling main');
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

            // 在发第三张牌后，让机器人叫主
            if (currentRound === 2) {
                setTimeout(() => {
                    const botId = gameState.players[1].id;
                    if (gameState && gameState.preGameState.canCallMain && !gameState.mainCalled) {
                        console.log('Bot is calling main');
                        
                        gameState.mainSuit = 'HEARTS';
                        gameState.mainCaller = botId;
                        gameState.mainCards = {
                            joker: 'BIG',
                            pair: { suit: 'HEARTS', value: 'A' }
                        };
                        gameState.mainCalled = true;
                        
                        if (gameState.preGameState.isDealing) {
                            gameState.preGameState.stealMainDelayed = true;
                            
                            io.to(roomId).emit('mainCalled', {
                                mainSuit: 'HEARTS',
                                mainCaller: botId,
                                mainCards: {
                                    joker: 'BIG',
                                    pair: { suit: 'HEARTS', value: 'A' }
                                }
                            });
                        }
                        
                        gameState.preGameState = {
                            ...gameState.preGameState,
                            canCallMain: false,
                            canStealMain: true
                        };
                        
                        io.to(roomId).emit('updateGameState', {
                            phase: 'pregame',
                            preGameState: {
                                ...gameState.preGameState,
                                commonMain: gameState.commonMain
                            }
                        });
                    }
                }, 2000);
            }

            if (currentRound >= totalRounds) {
                console.log('All cards dealt');
                gameState.preGameState.isDealing = false;
                
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
                    
                    io.to(roomId).emit('mainCalled', {
                        mainSuit: gameState.mainSuit,
                        mainCaller: gameState.mainCaller,
                        mainCards: gameState.mainCards,
                        stealMainDeadline: stealMainDeadline
                    });

                    // 在反主时限结束后进入粘牌阶段
                    setTimeout(() => {
                        if (!gameState.isMainFixed) {  // 如果没有加固
                            console.log('Entering stick phase');
                            gameState.phase = 'stickPhase';
                            gameState.preGameState = {
                                ...gameState.preGameState,
                                canStealMain: false,
                                canStickMain: true,
                                stickMainDeadline: Date.now() + 10000  // 给10秒粘牌时间
                            };
                            
                            io.to(roomId).emit('updateGameState', {
                                phase: 'stickPhase',
                                preGameState: gameState.preGameState
                            });
                        }
                    }, 10000);  // 反主时限结束后
                }
                
                return;
            }

            // 给真实玩家发牌
            if (currentRound < playerCards.length) {
                io.to(socket.id).emit('receiveCard', {
                    card: playerCards[currentRound],
                    cardIndex: currentRound,
                    totalCards: totalRounds
                });
                gameState.players[0].cards[currentRound] = playerCards[currentRound];
            } else {
                const card = remainingDeck.pop();
                io.to(socket.id).emit('receiveCard', {
                    card,
                    cardIndex: currentRound,
                    totalCards: totalRounds
                });
                gameState.players[0].cards[currentRound] = card;
            }

            // 给机器人发牌
            for (let i = 1; i < gameState.players.length; i++) {
                const player = gameState.players[i];
                let card;
                
                if (i === 1 && currentRound < botCards.length) {
                    // 给第一个机器人发预设的牌（用于叫主）
                    card = botCards[currentRound];
                } else {
                    // 给其他机器人发随机牌
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
            }

            // 广播发牌进度
            io.to(roomId).emit('dealingProgress', {
                currentRound: currentRound + 1,
                totalRounds
            });

            // 继续下一轮发牌
            setTimeout(() => {
                dealStickTestCards(currentRound + 1);
            }, 100);
        }

        // 存储游戏状态和房间信息
        games.set(roomId, gameState);
        rooms.set(roomId, room);
        
        socket.join(roomId);
        socket.emit('joinRoomSuccess', roomId);
        io.to(roomId).emit('roomInfo', room);
        
        socket.emit('testGameCreated', { 
            roomId,
            message: '粘牌测试：机器人将叫红桃主，您将获得小王和红桃连对以及黑桃连对，可以在粘牌阶段粘牌'
        });
        
        // 开始游戏
        setTimeout(() => {
            console.log('Starting stick test game...');
            io.to(roomId).emit('gameStart');
            
            setTimeout(() => {
                dealStickTestCards(0);
            }, 500);
        }, 1000);
    });
};