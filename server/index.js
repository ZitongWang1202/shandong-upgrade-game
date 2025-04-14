const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});
const cors = require('cors');

app.use(cors());

const rooms = new Map();
const games = new Map();

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

// 一轮发牌的函数（每人同时收到一张牌）
function dealNextRound(gameState, roomId, currentRound = 0) {
    const totalRounds = 26;
    console.log(`Dealing round ${currentRound + 1}/${totalRounds} for room ${roomId}`);
    
    // 第一张牌时，设置初始状态
    if (currentRound === 0) {
        console.log('First card dealt, can start calling main');
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

            // 10秒后无论是否有人加固或反主，都进入粘牌阶段
            setTimeout(() => {
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
            }, 10000);
        } else {
            // 如果没有人叫主，设置叫主截止时间（发牌结束后10秒）
            const callMainDeadline = Date.now() + 10000; // 10秒
            gameState.preGameState.callMainDeadline = callMainDeadline;
            
            io.to(roomId).emit('updateGameState', {
                phase: 'pregame',
                preGameState: {
                    ...gameState.preGameState,
                    commonMain: gameState.commonMain
                }
            });
            
            // 发牌结束后10秒内没有人叫主，准备开始新的一局
            setTimeout(() => {
                if (!gameState.mainCalled) {
                    console.log('No one called main within time limit');
                    gameState.preGameState.canCallMain = false;
                    io.to(roomId).emit('updateGameState', {
                        phase: 'pregame',
                        preGameState: {
                            ...gameState.preGameState,
                            commonMain: gameState.commonMain
                        }
                    });
                    // TODO: 这里添加开始新一局的逻辑
                    console.log('Should start a new round here');
                }
            }, 10000);
        }
        return;
    }

    // 给每个玩家发一张牌
    gameState.players.forEach((player, index) => {
        const card = player.cards[currentRound];
        console.log(`Sending card to player ${player.name}(${player.id}):`, card);
        
        io.to(player.id).emit('receiveCard', {
            card,
            cardIndex: currentRound,
            totalCards: totalRounds
        });
    });

    // 广播发牌进度和游戏状态
    io.to(roomId).emit('dealingProgress', {
        currentRound: currentRound + 1,
        totalRounds
    });

    // 继续下一轮发牌 间隔2秒
    setTimeout(() => {
        dealNextRound(gameState, roomId, currentRound + 1);
    }, 2000);
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

io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);

    // 获取房间列表
    socket.on('getRooms', () => {
        const roomList = Array.from(rooms.values()).map(room => ({
            id: room.id,
            players: room.players
        }));
        socket.emit('roomList', roomList);
    });

    // 创建房间
    socket.on('createRoom', () => {
        const roomId = Math.random().toString(36).slice(2, 8);
        rooms.set(roomId, {
            id: roomId,
            players: [{
                id: socket.id,
                ready: false,
                name: `玩家${socket.id.slice(0, 4)}`
            }]
        });
        socket.join(roomId);
        socket.emit('joinRoomSuccess', roomId);
        io.emit('roomList', Array.from(rooms.values()));
    });

    // 加入房间
    socket.on('joinRoom', (roomId) => {
        console.log(`Player ${socket.id} trying to join room ${roomId}`);
        const room = rooms.get(roomId);
        if (!room) {
            console.log(`Room ${roomId} not found`);
            socket.emit('joinRoomError', { error: 'Room not found' });
            return;
        }
        
        // 检查玩家是否已经在房间中
        const existingPlayer = room.players.find(p => p.id === socket.id);
        if (existingPlayer) {
            console.log(`Player ${socket.id} already in room ${roomId}`);
            socket.emit('joinRoomSuccess', roomId);
            socket.emit('roomInfo', room);
            return;
        }
        
        if (room.players.length < 4) {
            room.players.push({
                id: socket.id,
                ready: false,
                name: `玩家${socket.id.substr(0, 4)}`
            });
            socket.join(roomId);
            socket.emit('joinRoomSuccess', roomId);
            io.to(roomId).emit('roomInfo', room);
            io.emit('roomList', Array.from(rooms.values()));
            console.log(`Player ${socket.id} joined room ${roomId}`, room);
        } else {
            console.log(`Room ${roomId} is full`);
            socket.emit('joinRoomError', { error: 'Room is full' });
        }
    });

    // 获取房间信息
    socket.on('getRoomInfo', (roomId) => {
        console.log(`Getting room info for ${roomId}`);
        const room = rooms.get(roomId);
        if (room) {
            socket.emit('roomInfo', room);
            console.log(`Sent room info for ${roomId}:`, room);
        } else {
            console.log(`Room ${roomId} not found for getRoomInfo`);
            socket.emit('roomInfoError', { error: 'Room not found' });
        }
    });

    // 准备/取消准备
    socket.on('toggleReady', (roomId) => {
        console.log(`Player ${socket.id} toggling ready state in room ${roomId}`);
        const room = rooms.get(roomId);
        if (!room) {
            console.log(`Room ${roomId} not found for toggle ready`);
            socket.emit('toggleReadyError', { error: 'Room not found' });
            return;
        }
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) {
            console.log(`Player ${socket.id} not found in room ${roomId}`);
            socket.emit('toggleReadyError', { error: 'Player not found in room' });
            return;
        }
        
        // 取消准备状态
        player.ready = !player.ready;
        console.log(`Player ${socket.id} ready state toggled to ${player.ready}`);
        
        // 立即发送更新后的房间信息给所有玩家
        io.to(roomId).emit('roomInfo', room);
        
        // 检查是否所有玩家都准备好
        if (room.players.length === 4 && room.players.every(p => p.ready)) {
            console.log('All players ready, starting game');
            
            // 创建游戏状态
            const deck = shuffleDeck(createDeck());
            const gameState = {
                deck: deck,
                players: room.players.map(p => ({
                    ...p,
                    cards: [],
                    isDealer: false
                })),
                currentTurn: null,
                mainSuit: null,
                mainCaller: null,
                mainCards: null,
                phase: 'pregame',           // 游戏阶段
                preGameState: {            // pregame 阶段的子状态
                    isDealing: true,       // 是否在发牌
                    canCallMain: true,      // 是否可以叫主
                    canStickMain: false,    // 初始设置为false
                    commonMain: '2',         // 初始常主为2
                    canDealBottom: false,    // 是否可以抠底
                    bottomDealDeadline: null  // 抠底截止时间
                },
                currentRound: [],
                bottomCards: [],
                isMainFixed: false,
                mainCallDeadline: Date.now() + 100000, // 给100秒的叫主时间
                counterMainDeadline: null,
                mainCalled: false,
                dealerTeam: null,        // 庄家队伍 [player1.id, player3.id] 或 [player2.id, player4.id]
                bottomDealer: null,       // 抠底的玩家
                lastWinningTeam: null,   // 上一局赢的队伍
            };

            // 预先分配好牌
            for (let i = 0; i < 26; i++) {
                for (let j = 0; j < 4; j++) {
                    const card = gameState.deck.pop();
                    gameState.players[j].cards.push(card);
                }
            }

            // 设置庄家队伍
            gameState.bankerTeam = 1;

            // 保存底牌
            gameState.bottomCards = gameState.deck;
            console.log('Bottom cards:', gameState.bottomCards);
            
            // 存储游戏状态
            games.set(roomId, gameState);

            // 通知所有玩家游戏开始
            io.to(roomId).emit('gameStart');
            console.log('Sent gameStart event to all players in room', roomId);
        }
    });

    // 处理客户端准备好接收卡牌的信号
    socket.on('clientReady', () => {
        console.log(`Client ${socket.id} is ready to receive cards`);
        
        // 查找该玩家所在的房间
        let playerRoomId = null;
        rooms.forEach((room, roomId) => {
            if (room.players.some(p => p.id === socket.id)) {
                playerRoomId = roomId;
            }
        });
        
        if (!playerRoomId) {
            console.log(`No room found for player ${socket.id}`);
            return;
        }
        
        const gameState = games.get(playerRoomId);
        if (!gameState) {
            console.log(`No game state found for room ${playerRoomId}`);
            return;
        }
        
        console.log(`Starting to deal cards for player ${socket.id} in room ${playerRoomId}`);
        dealNextRound(gameState, playerRoomId, 0);
    });

    // 处理叫主
    socket.on('callMain', ({ roomId, mainSuit, mainCards }) => {
        console.log('Received callMain:', { roomId, mainSuit, mainCards });
        
        const gameState = games.get(roomId);
        if (gameState && gameState.preGameState.canCallMain && !gameState.mainCalled) {
            console.log('Setting main:', { mainSuit, mainCards });
            
            // 更新游戏状态
            gameState.mainSuit = mainSuit;
            gameState.mainCaller = socket.id;
            gameState.mainCards = mainCards;
            gameState.mainCalled = true;
            
            // 设置加固和反主的截止时间
            let stealMainDeadline;
            
            if (gameState.preGameState.isDealing) {
                // 如果在发牌时叫主，设置延迟标志，不立即设置反主截止时间
                gameState.preGameState.stealMainDelayed = true;
                
                // 通知所有玩家主花色已经被叫出（不包含反主截止时间）
                io.to(roomId).emit('mainCalled', {
                    mainSuit,
                    mainCaller: socket.id,
                    mainCards
                });
            } else {
                // 如果在发牌结束后叫主，则在叫主后10秒内可以加固和反主
                stealMainDeadline = Date.now() + 10000;
                gameState.preGameState.stealMainDeadline = stealMainDeadline;
                
                // 通知所有玩家主花色已经被叫出（包含反主截止时间）
                io.to(roomId).emit('mainCalled', {
                    mainSuit,
                    mainCaller: socket.id,
                    mainCards,
                    stealMainDeadline
                });

                // 10秒后无论是否有人加固或反主，都进入粘牌阶段
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
                }, 10000);
            }
            
            // 更新 preGameState
            gameState.preGameState = {
                ...gameState.preGameState,
                canCallMain: false,
                canStealMain: true,
                stealMainDeadline,
                commonMain: gameState.commonMain
            };
            
            io.to(roomId).emit('updateGameState', {
                phase: 'pregame',
                preGameState: {
                    ...gameState.preGameState,
                    commonMain: gameState.commonMain
                }
            });
        }
    });

    // 处理加固
    socket.on('fixMain', ({ roomId }) => {
        const gameState = games.get(roomId);
        if (gameState && gameState.mainCaller === socket.id && gameState.preGameState.canStealMain) {
            console.log('Main fixed by player:', socket.id);
            
            // 加固成功
            gameState.preGameState.canStealMain = false;  // 不能再反主
            gameState.isMainFixed = true;  // 设置主已加固的标志
            
            // 通知所有玩家主已加固，包含更完整的信息
            io.to(roomId).emit('mainFixed', {
                mainCaller: gameState.mainCaller,
                isMainFixed: true
            });
            
            // 更新游戏状态，也包含加固信息
            io.to(roomId).emit('updateGameState', {
                phase: 'pregame',
                preGameState: {
                    ...gameState.preGameState,
                    commonMain: gameState.commonMain
                },
                isMainFixed: gameState.isMainFixed
            });
        }
    });

    // 处理反主
    socket.on('counterMain', ({ roomId, mainSuit, mainCards }) => {
        const gameState = games.get(roomId);
        if (gameState && 
            gameState.preGameState.canStealMain && 
            !gameState.isMainFixed) {
            
            // 反主成功，更新状态
            gameState.preGameState.canStealMain = false;  // 设置为不可反主
            
            // 获取原来的叫主玩家的ID
            const originalMainCaller = gameState.mainCaller;
            const originalMainSuit = gameState.mainSuit;
            
            // 反主成功，更新主信息
            gameState.mainCaller = socket.id;
            gameState.mainSuit = mainSuit;  // 更新为反主玩家设置的花色
            gameState.mainCards = mainCards;
            
            // 反主后，不可再反主或加固
            gameState.preGameState.canStealMain = false;
            
            // 通知所有玩家
            io.to(roomId).emit('mainCountered', {
                mainCaller: socket.id,
                originalMainCaller,
                mainSuit,
                mainCards
            });
            
            // 更新游戏状态
            io.to(roomId).emit('updateGameState', {
                phase: 'pregame',
                preGameState: {
                    ...gameState.preGameState,
                    commonMain: gameState.commonMain
                }
            });
        }
    });

    // 处理粘牌请求
    socket.on('stickCards', ({ roomId }) => {
        const gameState = games.get(roomId);
        if (gameState && gameState.phase === 'stickPhase') {
            const player = gameState.players.find(p => p.id === socket.id);
            if (player) {
                // 设置该玩家为粘牌玩家
                gameState.stickPlayer = socket.id;
                
                // 只给粘牌玩家发送叫主玩家的牌信息
                socket.emit('playerStickCards', {
                    playerId: socket.id,
                    mainCallerCards: {
                        joker: gameState.mainCards?.joker,
                        pair: gameState.mainCards?.pair
                    }
                });

                // 给其他玩家只发送有人粘主的消息
                socket.broadcast.to(roomId).emit('playerStickCards', {
                    playerId: socket.id,
                    // 不包含 mainCallerCards
                });
            }
        }
    });

    // 处理确认交换
    socket.on('confirmStickCards', ({ roomId, cards }) => {
        console.log('Received confirmStickCards:', { roomId, cards });

        const gameState = games.get(roomId);
        if (!gameState) {
            console.log('Game state not found');
            return;
        }

        if (gameState.stickPlayer !== socket.id) {
            console.log('Not stick player');
            return;
        }

        // 执行牌的交换
        const mainPlayer = gameState.players.find(p => p.id === gameState.mainCaller);
        const stickPlayer = gameState.players.find(p => p.id === socket.id);
        
        if (!mainPlayer || !stickPlayer || !gameState.mainCards) {
            console.log('Players or mainCards not found');
            return;
        }

        // 执行交换
        const exchangeSuccess = exchangeCards(mainPlayer, stickPlayer, cards, gameState);
        console.log('Exchange result:', exchangeSuccess);
        
        if (exchangeSuccess) {
            // 确定抠底玩家
            gameState.bottomDealer = determineBottomDealer(gameState);
            
            // 进入抠底阶段
            gameState.phase = 'bottomDeal';
            gameState.preGameState = {
                ...gameState.preGameState,
                canStickMain: false,
                stickMainDeadline: null,
                bottomDealDeadline: Date.now() + 20000  // 给20秒抠底时间
            };
            
            // 确保底牌只有4张
            if (gameState.bottomCards.length !== 4) {
                console.log('底牌数量异常:', gameState.bottomCards.length, '设置为4张');
                // 如果底牌不足4张，添加缺失的牌
                while (gameState.bottomCards.length < 4) {
                    const randomCard = { 
                        suit: ['HEARTS', 'SPADES', 'DIAMONDS', 'CLUBS'][Math.floor(Math.random() * 4)], 
                        value: ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'][Math.floor(Math.random() * 13)]
                    };
                    gameState.bottomCards.push(randomCard);
                }
                // 如果底牌超过4张，截取前4张
                if (gameState.bottomCards.length > 4) {
                    gameState.bottomCards = gameState.bottomCards.slice(0, 4);
                }
            }
            
            console.log('发送的底牌数据:', gameState.bottomCards);
            console.log('发送的底牌数量:', gameState.bottomCards.length);
            
            // 发送底牌给抠底玩家
            io.to(gameState.bottomDealer).emit('receiveBottomCards', {
                bottomCards: gameState.bottomCards
            });
            
            // 通知所有玩家进入抠底阶段
            io.to(roomId).emit('updateGameState', {
                phase: 'bottomDeal',
                bottomDealer: gameState.bottomDealer,
                preGameState: gameState.preGameState
            });

            // 添加以下代码：将底牌添加到玩家手牌中
            const bottomDealer = gameState.players.find(p => p.id === gameState.bottomDealer);
            if (bottomDealer) {
                console.log('抠底前玩家手牌数量:', bottomDealer.cards.length);
                console.log('底牌数量:', gameState.bottomCards.length);
                
                // 标记底牌是新加入的，添加唯一ID标识
                const markedBottomCards = gameState.bottomCards.map((card, index) => ({
                    ...card,
                    isFromBottom: true,
                    bottomId: `bottom-${Date.now()}-${index}` // 添加唯一标识
                }));
                
                console.log('标记的底牌:', markedBottomCards);
                
                // 使用展开运算符添加底牌
                bottomDealer.cards = [...bottomDealer.cards, ...markedBottomCards];
                
                console.log('抠底后玩家手牌数量:', bottomDealer.cards.length);
                console.log('玩家手牌详情:', bottomDealer.cards);
                
                // 发送更新后的手牌给玩家
                io.to(gameState.bottomDealer).emit('updatePlayerCards', bottomDealer.cards);
            }

            // 发送底牌信息（先于手牌更新发送）
            socket.emit('receiveBottomCards', {
                bottomCards: gameState.bottomCards
            });
        } else {
            // 交换失败通知
            socket.emit('exchangeError', {
                message: '选择的牌不符合规则'
            });
        }
    });

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

    // 离开房间
    socket.on('leaveRoom', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            // 检查是否有机器人玩家
            const hasBots = room.players.some(p => p.isBot);
            
            // 移除当前玩家
            room.players = room.players.filter(p => p.id !== socket.id);
            
            // 如果有机器人且房间里只剩下机器人，删除整个房间
            if (hasBots && !room.players.some(p => !p.isBot)) {
                console.log('Room only has bots, deleting room:', roomId);
                rooms.delete(roomId);
                games.delete(roomId);
            } else if (room.players.length === 0) {
                rooms.delete(roomId);
                games.delete(roomId);
            }
            
            socket.leave(roomId);
            io.to(roomId).emit('roomInfo', room);
            io.emit('roomList', Array.from(rooms.values()));
        }
    });

    // 断开连接
    socket.on('disconnect', () => {
        console.log('用户断开连接:', socket.id);
        
        // 遍历所有房间
        rooms.forEach((room, roomId) => {
            if (room.players.some(p => p.id === socket.id)) {
                // 检查是否有机器人玩家
                const hasBots = room.players.some(p => p.isBot);
                
                // 移除断开连接的玩家
                room.players = room.players.filter(p => p.id !== socket.id);
                
                // 如果有机器人且房间里只剩下机器人，删除整个房间
                if (hasBots && !room.players.some(p => !p.isBot)) {
                    console.log('Room only has bots after disconnect, deleting room:', roomId);
                    rooms.delete(roomId);
                    games.delete(roomId);
                } else if (room.players.length === 0) {
                    rooms.delete(roomId);
                    games.delete(roomId);
                } else {
                    io.to(roomId).emit('roomInfo', room);
                }
            }
        });
        
        io.emit('roomList', Array.from(rooms.values()));
    });

    // 获取当前房间
    socket.on('getCurrentRoom', () => {
        // 查找该 socket 所在的房间
        let currentRoomId = null;
        rooms.forEach((room, roomId) => {
            if (room.players.some(p => p.id === socket.id)) {
                currentRoomId = roomId;
            }
        });
        
        socket.emit('currentRoom', currentRoomId);
    });

    // 创建测试游戏（一键式测试）
    socket.on('createTestGame', () => {
        console.log('Creating test game...');
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
            phase: 'pregame',           // 游戏阶段
            preGameState: {            // pregame 阶段的子状态
                isDealing: true,       // 是否在发牌
                canCallMain: true      // 是否可以叫主
            },
            currentRound: [],
            bottomCards: [],
            isMainFixed: false,
            mainCallDeadline: Date.now() + 100000, // 叫主截止时间
            counterMainDeadline: null,
            mainCalled: false,
            commonMain: '2',  // 初始常主为2
            dealerTeam: null,        // 庄家队伍 [player1.id, player3.id] 或 [player2.id, player4.id]
            bottomDealer: null,       // 抠底的玩家
            lastWinningTeam: null,   // 上一局赢的队伍
        };

        // 预先准备好牌，但不立即分配
        const preparedCards = {
            player: [
                { suit: 'JOKER', value: 'BIG' },  // 大王
                { suit: 'HEARTS', value: 'A' },    // 红桃A
                { suit: 'HEARTS', value: 'A' },     // 红桃A
                { suit: 'HEARTS', value: '5' },    // 红桃5
                { suit: 'SPADES', value: '5' },    // 黑桃5
                { suit: 'HEARTS', value: '3' },    // 红桃3
                { suit: 'DIAMONDS', value: '3' },    // 方片3
                { suit: 'CLUBS', value: '2' },    // 梅花2
                { suit: 'HEARTS', value: '2' },    // 红桃2
            ],
            remainingDeck: deck.filter(card => 
                !(card.suit === 'JOKER' && card.value === 'BIG') &&
                !(card.suit === 'HEARTS' && card.value === 'A')
            )
        };

        // 修改 dealNextRound 函数的调用方式
        function dealTestCards(currentRound = 0) {
            const totalRounds = 26;
            console.log(`Dealing test round ${currentRound + 1}/${totalRounds}`);

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
            if (currentRound < 9) {
                // 发送预设的前三张牌
                io.to(socket.id).emit('receiveCard', {
                    card: preparedCards.player[currentRound],
                    cardIndex: currentRound,
                    totalCards: totalRounds
                });
                gameState.players[0].cards[currentRound] = preparedCards.player[currentRound];
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
                dealTestCards(currentRound + 1);
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
            message: '测试模式：已自动添加3个机器人玩家，您可以随时返回大厅'
        });
        
        // 开始游戏和发牌
        setTimeout(() => {
            console.log('Starting test game...');
            io.to(roomId).emit('gameStart');
            
            // 使用新的发牌函数
            setTimeout(() => {
                dealTestCards(0);
            }, 1000);
        }, 2000);
    });

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
            message: '加固测试：您将收到一张大王和两张红桃A，第10张牌将是第二张大王'
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
            !(playerCards.some(pc => pc.suit === card.suit && pc.value === card.value))
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
                                determineBottomDealer(gameState);
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
                                determineBottomDealer(gameState);
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

            // 给真实玩家发随机牌
            const card = remainingDeck.pop();
            io.to(socket.id).emit('receiveCard', {
                card,
                cardIndex: currentRound,
                totalCards: totalRounds
            });
            gameState.players[0].cards[currentRound] = card;

            // 给机器人发牌
            for (let i = 1; i < 4; i++) {
                if (i === 1 && currentRound < botCards.length) {
                    // 给第一个机器人发预设的牌（用于叫主和加固）
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

            // 继续下一轮发牌
            setTimeout(() => {
                dealBotFixTestCards(currentRound + 1);
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
            message: '机器人加固测试：机器人将收到两张大王和两张红桃A，它会叫主并在5秒后加固'
        });
        
        // 开始游戏和发牌
        setTimeout(() => {
            console.log('Starting bot fix test game...');
            io.to(roomId).emit('gameStart');
            
            // 使用新的发牌函数
            setTimeout(() => {
                dealBotFixTestCards(0);
            }, 1000);
        }, 2000);
    });

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
            for (let i = 1; i < 4; i++) {
                if (i === 1 && currentRound < botCards.length) {
                    gameState.players[i].cards[currentRound] = botCards[currentRound];
                } else {
                    const card = remainingDeck.pop();
                    gameState.players[i].cards[currentRound] = card;
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
            }, 1000);
        }

        // 存储游戏状态和房间信息
        games.set(roomId, gameState);
        rooms.set(roomId, room);
        
        socket.join(roomId);
        socket.emit('joinRoomSuccess', roomId);
        io.to(roomId).emit('roomInfo', room);
        
        socket.emit('testGameCreated', { 
            roomId,
            message: '粘牌测试：机器人将用大王和红桃A对叫主，您将收到小王、红桃3、红桃6、红桃7和黑桃6677用于粘牌'
        });
        
        // 开始游戏
        setTimeout(() => {
            console.log('Starting stick test game...');
            io.to(roomId).emit('gameStart');
            
            setTimeout(() => {
                dealStickTestCards(0);
            }, 1000);
        }, 2000);
    });

    // 添加处理抠底的事件
    socket.on('confirmBottomDeal', ({ roomId, putCards }) => {
        const gameState = games.get(roomId);
        if (!gameState || gameState.bottomDealer !== socket.id) {
            console.log('无效的抠底请求');
            return;
        }
        
        // 验证放入底牌的数量
        if (putCards.length !== 4) {
            console.log('底牌数量不符合要求:', putCards.length);
            socket.emit('bottomDealError', { message: '必须放入4张牌' });
            return;
        }
        
        console.log('玩家放入的底牌:', putCards);
        
        // 更新底牌
        gameState.bottomCards = putCards;
        
        // 从玩家手牌中移除这些牌
        const bottomDealer = gameState.players.find(p => p.id === socket.id);
        if (!bottomDealer) {
            console.log('找不到抠底玩家');
            return;
        }
        
        bottomDealer.cards = bottomDealer.cards.filter(card => 
            !putCards.some(pc => pc.suit === card.suit && pc.value === card.value)
        );
        
        console.log('抠底后玩家剩余的牌数量:', bottomDealer.cards.length);
        
        // 进入游戏阶段
        gameState.phase = 'playing';
        io.to(roomId).emit('updateGameState', {
            phase: 'playing'
        });
        
        // 更新抠底玩家的手牌
        socket.emit('updatePlayerCards', bottomDealer.cards);
        
        // 通知所有玩家抠底完成
        io.to(roomId).emit('bottomDealCompleted', {
            bottomDealer: socket.id
        });
    });

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

                            // 添加监听抠底完成事件，自动进入出牌阶段
                            const originalListener = socket.listeners('confirmBottomDeal').find(listener => true);
                            
                            // 临时移除原始监听器，以便添加我们的特殊处理
                            if (originalListener) {
                                socket.removeListener('confirmBottomDeal', originalListener);
                            }
                            
                            // 添加一次性监听器，处理抠底
                            socket.once('confirmBottomDeal', (data) => {
                                // 先执行原始的抠底逻辑
                                if (originalListener) {
                                    originalListener(data);
                                }
                                
                                // 然后设置为出牌阶段
                                setTimeout(() => {
                                    console.log('Entering playing phase after bottom deal');
                                    gameState.phase = 'playing';
                                    
                                    // 设置当前出牌玩家为抠底玩家
                                    gameState.currentPlayer = gameState.bottomDealer;
                                    gameState.firstPlayerInRound = gameState.bottomDealer;
                                    
                                    // 通知所有玩家进入出牌阶段
                                    io.to(roomId).emit('gamePhaseChanged', {
                                        phase: 'playing',
                                        currentPlayer: gameState.currentPlayer,
                                        bottomDealer: gameState.bottomDealer
                                    });
                                    
                                    // 通知当前玩家轮到他出牌 - 确保这个事件被发送
                                    io.to(roomId).emit('playerTurn', {
                                        player: gameState.currentPlayer
                                    });
                                }, 1000);
                            });
                            
                            // 已移除自动抠底的设置
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
            message: '抠底测试：对家将叫红桃主，您将抠底'
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

    // 添加处理出牌的事件
    socket.on('playCards', (data) => {
        console.log('收到出牌请求:', data);
        const gameState = games.get(data.roomId);
        if (!gameState) {
            console.log('找不到游戏状态:', data.roomId);
            return;
        }
        
        // 检查是否轮到该玩家出牌
        if (gameState.currentPlayer !== socket.id) {
            console.log('不是该玩家的回合:', socket.id, '当前玩家:', gameState.currentPlayer);
            socket.emit('playError', { message: '还没轮到你出牌' });
            return;
        }
        
        // 获取当前玩家信息
        const currentPlayerIndex = gameState.players.findIndex(p => p.id === socket.id);
        const currentPlayer = gameState.players[currentPlayerIndex];
        
        if (!currentPlayer) {
            console.log('找不到当前玩家');
            socket.emit('playError', { message: '找不到玩家信息' });
            return;
        }
        
        console.log('当前玩家信息:', currentPlayer.name, '手牌数量:', currentPlayer.cards.length);
        
        // 从玩家手牌中移除这些牌
        const playedCards = data.cards;
        console.log('玩家出牌:', playedCards);
        
        // 验证玩家手牌中是否有这些牌
        const hasAllCards = playedCards.every(playedCard => 
            currentPlayer.cards.some(card => 
                card.suit === playedCard.suit && card.value === playedCard.value
            )
        );
        
        if (!hasAllCards) {
            console.log('玩家手牌中没有包含所有出的牌');
            socket.emit('playError', { message: '你的手牌中没有包含所有要出的牌' });
            return;
        }
        
        // 从玩家手牌中移除这些牌
        currentPlayer.cards = currentPlayer.cards.filter(card => 
            !playedCards.some(pc => pc.suit === card.suit && pc.value === card.value)
        );
        
        console.log('出牌后玩家手牌数量:', currentPlayer.cards.length);
        
        // 更新游戏状态
        gameState.roundCards.push({
            player: socket.id,
            cards: playedCards
        });
        
        // 通知所有玩家有人出牌
        io.to(data.roomId).emit('cardPlayed', {
            player: socket.id,
            cards: playedCards,
            playerName: currentPlayer.name
        });
        
        // 通知当前玩家更新手牌
        socket.emit('updatePlayerCards', currentPlayer.cards);
        
        // 确定下一个出牌玩家
        const nextPlayerIndex = (currentPlayerIndex + 1) % gameState.players.length;
        const nextPlayer = gameState.players[nextPlayerIndex];
        gameState.currentPlayer = nextPlayer.id;
        
        console.log('下一个出牌玩家:', nextPlayer.name, nextPlayer.id);
        
        // 通知所有玩家轮到谁出牌
        io.to(data.roomId).emit('playerTurn', {
            player: gameState.currentPlayer,
            playerName: nextPlayer.name
        });
        
        // 如果下一个玩家是机器人，让它自动出牌
        if (nextPlayer.isBot) {
            // 延迟2秒出牌，模拟思考时间
            setTimeout(() => {
                console.log('机器人出牌:', nextPlayer.name);
                
                // 如果机器人没有牌了，结束游戏
                if (nextPlayer.cards.length === 0) {
                    console.log('机器人没有牌了，游戏结束');
                    return;
                }
                
                // 机器人随机选择一张牌出
                const randomIndex = Math.floor(Math.random() * nextPlayer.cards.length);
                const botCard = nextPlayer.cards[randomIndex];
                
                console.log('机器人选择的牌:', botCard);
                
                // 从机器人手牌中移除这张牌
                nextPlayer.cards.splice(randomIndex, 1);
                
                // 更新游戏状态
                gameState.roundCards.push({
                    player: nextPlayer.id,
                    cards: [botCard]
                });
                
                // 通知所有玩家有人出牌
                io.to(data.roomId).emit('cardPlayed', {
                    player: nextPlayer.id,
                    cards: [botCard],
                    playerName: nextPlayer.name
                });
                
                // 确定下一个出牌玩家
                const nextBotPlayerIndex = (nextPlayerIndex + 1) % gameState.players.length;
                const nextBotPlayer = gameState.players[nextBotPlayerIndex];
                gameState.currentPlayer = nextBotPlayer.id;
                
                console.log('下一个出牌玩家:', nextBotPlayer.name, nextBotPlayer.id);
                
                // 通知所有玩家轮到谁出牌
                io.to(data.roomId).emit('playerTurn', {
                    player: gameState.currentPlayer,
                    playerName: nextBotPlayer.name
                });
                
                // 如果下一个玩家还是机器人，继续递归调用
                if (nextBotPlayer.isBot) {
                    // 这里使用事件循环来避免递归调用导致的调用栈溢出
                    setTimeout(() => {
                        // 模拟机器人出牌请求
                        const fakeEvent = {
                            roomId: data.roomId,
                            cards: [nextBotPlayer.cards[0]] // 只是一个占位符，实际上会被忽略
                        };
                        
                        // 重用当前处理函数的逻辑，但不传递socket参数
                        botPlayCards(fakeEvent, nextBotPlayer.id, gameState);
                    }, 2000);
                }
            }, 2000);
        }
    });

    // 添加机器人出牌的辅助函数
    function botPlayCards(data, botId, gameState) {
        console.log('机器人出牌函数被调用:', botId);
        
        // 获取当前机器人信息
        const currentPlayerIndex = gameState.players.findIndex(p => p.id === botId);
        const currentPlayer = gameState.players[currentPlayerIndex];
        
        if (!currentPlayer) {
            console.log('找不到机器人玩家');
            return;
        }
        
        console.log('当前机器人信息:', currentPlayer.name, '手牌数量:', currentPlayer.cards.length);
        
        // 如果机器人没有牌了，结束游戏
        if (currentPlayer.cards.length === 0) {
            console.log('机器人没有牌了，游戏结束');
            return;
        }
        
        // 机器人随机选择一张牌出
        const randomIndex = Math.floor(Math.random() * currentPlayer.cards.length);
        const botCard = currentPlayer.cards[randomIndex];
        
        console.log('机器人选择的牌:', botCard);
        
        // 从机器人手牌中移除这张牌
        currentPlayer.cards.splice(randomIndex, 1);
        
        // 更新游戏状态
        gameState.roundCards.push({
            player: botId,
            cards: [botCard]
        });
        
        // 通知所有玩家有人出牌
        io.to(data.roomId).emit('cardPlayed', {
            player: botId,
            cards: [botCard],
            playerName: currentPlayer.name
        });
        
        // 确定下一个出牌玩家
        const nextPlayerIndex = (currentPlayerIndex + 1) % gameState.players.length;
        const nextPlayer = gameState.players[nextPlayerIndex];
        gameState.currentPlayer = nextPlayer.id;
        
        console.log('下一个出牌玩家:', nextPlayer.name, nextPlayer.id);
        
        // 通知所有玩家轮到谁出牌
        io.to(data.roomId).emit('playerTurn', {
            player: gameState.currentPlayer,
            playerName: nextPlayer.name
        });
        
        // 如果下一个玩家还是机器人，继续递归调用
        if (nextPlayer.isBot) {
            // 这里使用事件循环来避免递归调用导致的调用栈溢出
            setTimeout(() => {
                // 模拟机器人出牌请求
                const fakeEvent = {
                    roomId: data.roomId,
                    cards: [nextPlayer.cards[0]] // 只是一个占位符，实际上会被忽略
                };
                
                // 重用当前处理函数的逻辑
                botPlayCards(fakeEvent, nextPlayer.id, gameState);
            }, 2000);
        }
    }

    // 添加结束轮次的函数
    function endRound(gameState, roomId) {
        // TODO: 判断本轮赢家
        // const winner = determineRoundWinner(gameState.roundCards, gameState.mainSuit);
        const winner = gameState.players[0]; // 临时，假设第一个玩家赢
        
        // 更新游戏状态
        gameState.roundNumber++;
        gameState.currentPlayer = winner;
        gameState.firstPlayerInRound = winner;
        gameState.roundCards = [];
        
        // 通知所有玩家轮次结束
        io.to(roomId).emit('roundEnd', {
            winner: winner,
            nextPlayer: winner
        });
    }

    // 创建出牌测试游戏
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
            lastWinningTeam: null,
            currentPlayer: null,  // 当前出牌玩家
            firstPlayerInRound: null, // 当前轮次首个出牌玩家
            roundCards: [],  // 当前轮次出的牌
            roundNumber: 1   // 轮次计数
        };

        function dealPlayingTestCards(currentRound = 0) {
            const totalRounds = 26;  // 每人26张牌
            console.log(`Dealing playing test round ${currentRound + 1}/${totalRounds}`);

            // 第一张牌时，设置初始状态
            if (currentRound === 0) {
                console.log('First playing test card dealt');
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

                            // 添加监听抠底完成事件，自动进入出牌阶段
                            const originalListener = socket.listeners('confirmBottomDeal').find(listener => true);
                            
                            // 临时移除原始监听器，以便添加我们的特殊处理
                            if (originalListener) {
                                socket.removeListener('confirmBottomDeal', originalListener);
                            }
                            
                            // 添加一次性监听器，处理抠底
                            socket.once('confirmBottomDeal', (data) => {
                                // 先执行原始的抠底逻辑
                                if (originalListener) {
                                    originalListener(data);
                                }
                                
                                // 然后设置为出牌阶段
                                setTimeout(() => {
                                    console.log('Entering playing phase after bottom deal');
                                    gameState.phase = 'playing';
                                    
                                    // 设置当前出牌玩家为抠底玩家
                                    gameState.currentPlayer = gameState.bottomDealer;
                                    gameState.firstPlayerInRound = gameState.bottomDealer;
                                    
                                    // 通知所有玩家进入出牌阶段
                                    io.to(roomId).emit('gamePhaseChanged', {
                                        phase: 'playing',
                                        currentPlayer: gameState.currentPlayer,
                                        bottomDealer: gameState.bottomDealer
                                    });
                                    
                                    // 通知当前玩家轮到他出牌 - 确保这个事件被发送
                                    io.to(roomId).emit('playerTurn', {
                                        player: gameState.currentPlayer
                                    });
                                }, 1000);
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
                dealPlayingTestCards(currentRound + 1);
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
            message: '出牌测试：对家将叫红桃主，您将抠底，然后进入出牌阶段'
        });
        
        // 开始游戏
        setTimeout(() => {
            console.log('Starting playing test game...');
            io.to(roomId).emit('gameStart');
            
            setTimeout(() => {
                dealPlayingTestCards(0);
            }, 500);
        }, 1000);
    });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});