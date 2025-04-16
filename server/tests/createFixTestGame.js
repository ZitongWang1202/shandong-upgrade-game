module.exports = function(socket, io, games, rooms, utils) {
    const { createDeck, shuffleDeck, handleBotPlay, endRound, getPlayerTeam, determineBottomDealer } = utils;

    // 创建加固测试游戏
    socket.on('createFixTestGame', () => {
        console.log('Creating fix main test game...');
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

        // 预先准备好牌
        const preparedCards = {
            player: [
                { suit: 'JOKER', value: 'BIG' },  // 大王
                { suit: 'HEARTS', value: 'A' },    // 红桃A
                { suit: 'HEARTS', value: 'A' }     // 红桃A
            ],
            // 在牌堆中移除这些已经分配的牌
            remainingDeck: deck.filter(card => 
                !(card.suit === 'JOKER' && card.value === 'BIG') &&
                !(card.suit === 'HEARTS' && card.value === 'A')
            )
        };

        // 第10张牌设置为第二张大王
        const secondBigJoker = { suit: 'JOKER', value: 'BIG' };
        
        function dealFixTestCards(currentRound = 0) {
            const totalRounds = 26;
            console.log(`Dealing fix test round ${currentRound + 1}/${totalRounds}`);

            // 第一张牌时，设置初始状态
            if (currentRound === 0) {
                console.log('First test card dealt, can start calling main');
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
                }
                
                // 更新游戏状态
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: {
                        ...gameState.preGameState,
                        commonMain: gameState.commonMain
                    }
                });
                
                // 设置叫主截止时间（发牌结束后10秒）
                const callMainDeadline = Date.now() + 10000; // 10秒而不是100秒
                gameState.preGameState.callMainDeadline = callMainDeadline;
                
                // 通知客户端
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: {
                        ...gameState.preGameState,
                        commonMain: gameState.commonMain
                    }
                });
                
                return;
            }

            // 给真实玩家发牌
            if (currentRound < 3) {
                // 发送预设的前三张牌
                io.to(socket.id).emit('receiveCard', {
                    card: preparedCards.player[currentRound],
                    cardIndex: currentRound,
                    totalCards: totalRounds
                });
                gameState.players[0].cards[currentRound] = preparedCards.player[currentRound];
            } else if (currentRound === 9) {
                // 第10张牌是第二张大王
                io.to(socket.id).emit('receiveCard', {
                    card: secondBigJoker,
                    cardIndex: currentRound,
                    totalCards: totalRounds
                });
                gameState.players[0].cards[currentRound] = secondBigJoker;
            } else {
                // 发送随机牌
                const card = preparedCards.remainingDeck.pop();
                io.to(socket.id).emit('receiveCard', {
                    card,
                    cardIndex: currentRound,
                    totalCards: totalRounds
                });
                gameState.players[0].cards[currentRound] = card;
            }

            // 给机器人发牌
            for (let i = 1; i < 4; i++) {
                const card = preparedCards.remainingDeck.pop();
                gameState.players[i].cards[currentRound] = card;
            }

            // 广播发牌进度
            io.to(roomId).emit('dealingProgress', {
                currentRound: currentRound + 1,
                totalRounds
            });

            // 继续下一轮发牌
            setTimeout(() => {
                dealFixTestCards(currentRound + 1);
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
            message: '加固测试：您将收到一张大王和两张红桃A用于叫主，然后在第10张牌会收到另一张大王用于加固'
        });
        
        // 开始游戏和发牌
        setTimeout(() => {
            console.log('Starting fix test game...');
            io.to(roomId).emit('gameStart');
            
            // 使用新的发牌函数
            setTimeout(() => {
                dealFixTestCards(0);
            }, 1000);
        }, 2000);
    });
};