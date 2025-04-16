module.exports = function(socket, io, games, rooms, utils) {
    const { createDeck, shuffleDeck, handleBotPlay, endRound, getPlayerTeam, determineBottomDealer, exchangeCards } = utils;

    // 创建抠底测试游戏
    socket.on('createBottomTestGame', () => {
        console.log('Creating bottom test game...');
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
        
        // 创建牌堆
        const fullDeck = createDeck();
        console.log('原始牌堆数量:', fullDeck.length);
        
        // 预先准备对家（机器人）的牌
        const botCards = [
            { suit: 'JOKER', value: 'BIG' },  // 大王
            { suit: 'HEARTS', value: 'A' },    // 红桃A
            { suit: 'HEARTS', value: 'A' }     // 红桃A
        ];
        
        // 从牌堆中移除这些预设的牌
        // 这里先找到第一张与预设牌匹配的牌并移除，避免移除多张
        const deck = [...fullDeck]; // 复制一份以便修改
        
        botCards.forEach(botCard => {
            const cardIndex = deck.findIndex(card => 
                card.suit === botCard.suit && card.value === botCard.value
            );
            
            if (cardIndex !== -1) {
                deck.splice(cardIndex, 1);
                console.log(`已从牌堆中移除 ${botCard.suit} ${botCard.value}`);
            } else {
                console.log(`牌堆中未找到 ${botCard.suit} ${botCard.value}`);
            }
        });
        
        console.log('移除预设牌后的牌堆数量:', deck.length);
        
        // 洗牌
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
            bankerTeam: 1,  // 设置1队为庄家队
            bottomDealer: null,
            lastWinningTeam: null
        };

        function dealBottomTestCards(currentRound = 0) {
            const totalRounds = 26;  // 每人26张牌
            console.log(`Dealing bottom test round ${currentRound + 1}/${totalRounds}`);

            // 第一张牌时，设置初始状态
            if (currentRound === 0) {
                console.log('First bottom test card dealt');
                gameState.preGameState = {
                    isDealing: true,
                    canCallMain: true,
                    commonMain: gameState.preGameState.commonMain || '2'
                };
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: gameState.preGameState
                });
            }

            // 在发第三张牌后，让对家（机器人）叫主
            if (currentRound === 2) {
                setTimeout(() => {
                    // 获取对家机器人的ID（玩家位置+2）
                    const partnerIndex = 2;  // 对家位置
                    const botId = gameState.players[partnerIndex].id;
                    
                    if (gameState && gameState.preGameState.canCallMain && !gameState.mainCalled) {
                        console.log('Bot partner is calling main');
                        
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
                                commonMain: gameState.preGameState.commonMain
                            }
                        });
                    }
                }, 500);
            }

            if (currentRound >= totalRounds) {
                console.log('All cards dealt');
                gameState.preGameState.isDealing = false;
                
                // 发完牌后，剩下的牌作为底牌（应该正好是4张）
                gameState.bottomCards = gameState.deck;
                console.log('底牌设置完成:', gameState.bottomCards);
                console.log('底牌数量:', gameState.bottomCards.length);
                
                if (gameState.mainCalled && gameState.preGameState.stealMainDelayed) {
                    console.log('Setting steal main deadline after dealing completed');
                    const stealMainDeadline = Date.now() + 3000;
                    gameState.preGameState.stealMainDeadline = stealMainDeadline;
                    gameState.preGameState.stealMainDelayed = false;
                    
                    io.to(roomId).emit('updateGameState', {
                        phase: 'pregame',
                        preGameState: {
                            ...gameState.preGameState,
                            commonMain: gameState.preGameState.commonMain
                        }
                    });
                    
                    io.to(roomId).emit('mainCalled', {
                        mainSuit: gameState.mainSuit,
                        mainCaller: gameState.mainCaller,
                        mainCards: gameState.mainCards,
                        stealMainDeadline: stealMainDeadline
                    });

                    // 3秒后进入粘牌阶段
                    setTimeout(() => {
                        console.log('Entering stick phase');
                        gameState.phase = 'stickPhase';
                        gameState.preGameState = {
                            ...gameState.preGameState,
                            canStealMain: false,
                            canStickMain: true,
                            stickMainDeadline: Date.now() + 3000
                        };
                        
                        io.to(roomId).emit('updateGameState', {
                            phase: 'stickPhase',
                            preGameState: gameState.preGameState
                        });

                        // 3秒后进入抠底阶段
                        setTimeout(() => {
                            console.log('Entering bottom deal phase');
                            // 设置抠底玩家（玩家本人，因为是庄家队）
                            gameState.bottomDealer = socket.id;
                            gameState.phase = 'bottomDeal';
                            
                            gameState.preGameState = {
                                ...gameState.preGameState,
                                canStickMain: false,
                                stickMainDeadline: null,
                                bottomDealDeadline: Date.now() + 20000  // 给20秒抠底时间
                            };
                            
                            // 查找抠底玩家并添加底牌到他的手牌中
                            const bottomDealerPlayer = gameState.players.find(p => p.id === gameState.bottomDealer);
                            if (bottomDealerPlayer) {
                                console.log('抠底前玩家手牌数量:', bottomDealerPlayer.cards.length);
                                console.log('底牌数量:', gameState.bottomCards.length);
                                
                                // 清除之前可能添加的标记（防止重复添加）
                                bottomDealerPlayer.cards = bottomDealerPlayer.cards.filter(card => !card.isFromBottom);
                                
                                // 标记底牌并添加到玩家手牌
                                const markedBottomCards = gameState.bottomCards.map(card => ({
                                    ...card,
                                    isFromBottom: true,
                                    bottomId: `${card.suit}-${card.value}`
                                }));
                                
                                console.log('标记的底牌:', markedBottomCards);
                                
                                // 使用展开运算符添加底牌
                                bottomDealerPlayer.cards = [...bottomDealerPlayer.cards, ...markedBottomCards];
                                
                                console.log('抠底后玩家手牌数量:', bottomDealerPlayer.cards.length);
                                console.log('玩家手牌详情:', bottomDealerPlayer.cards);
                                
                                // 发送更新后的手牌给玩家
                                io.to(gameState.bottomDealer).emit('updatePlayerCards', bottomDealerPlayer.cards);
                            }
                            
                            // 发送底牌信息
                            socket.emit('receiveBottomCards', {
                                bottomCards: gameState.bottomCards
                            });
                            
                            // 通知所有玩家进入抠底阶段
                            io.to(roomId).emit('updateGameState', {
                                phase: 'bottomDeal',
                                bottomDealer: gameState.bottomDealer,
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
                
                // 对家特定位置给特定的牌
                if (index === 2 && currentRound < botCards.length) {
                    card = botCards[currentRound];
                } else {
                    card = gameState.deck.pop();
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
                dealBottomTestCards(currentRound + 1);
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
            message: '抠底测试：对家将叫红桃主，您将抠底，底牌将被高亮显示'
        });
        
        // 开始游戏
        setTimeout(() => {
            console.log('Starting bottom test game...');
            io.to(roomId).emit('gameStart');
            
            setTimeout(() => {
                dealBottomTestCards(0);
            }, 500);
        }, 1000);
    });
};