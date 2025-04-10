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
                    commonMain: '2'         // 初始常主为2
                },
                currentRound: [],
                bottomCards: [],
                isMainFixed: false,
                mainCallDeadline: Date.now() + 100000, // 给100秒的叫主时间
                counterMainDeadline: null,
                mainCalled: false
            };

            // 预先分配好牌
            for (let i = 0; i < 26; i++) {
                for (let j = 0; j < 4; j++) {
                    const card = gameState.deck.pop();
                    gameState.players[j].cards.push(card);
                }
            }

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
                            stickMainDeadline: Date.now() + 10000
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
            // 清除粘牌相关状态
            gameState.stickPlayer = null;
            gameState.preGameState = {
                ...gameState.preGameState,
                canStickMain: false,
                stickMainDeadline: null,
                canStealMain: false,  // 清除反主状态
                stealMainDeadline: null  // 清除反主截止时间
            };
            
            // 通知玩家交换完成
            io.to(roomId).emit('cardsExchanged', {
                mainPlayer: gameState.mainCaller,
                stickPlayer: socket.id
            });
            
            // 进入游戏阶段
            gameState.phase = 'playing';
            io.to(roomId).emit('updateGameState', {
                phase: 'playing',
                preGameState: {
                    ...gameState.preGameState,
                    canStickMain: false,
                    stickMainDeadline: null,
                    canStealMain: false,
                    stealMainDeadline: null
                }
            });

            // 更新玩家手牌
            io.to(mainPlayer.id).emit('updatePlayerCards', mainPlayer.cards);
            io.to(stickPlayer.id).emit('updatePlayerCards', stickPlayer.cards);
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
            commonMain: '2'  // 初始常主为2
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
            commonMain: '2'  // 初始常主为2
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
            commonMain: '2'  // 初始常主为2
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
            commonMain: '2'  // 初始常主为2
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
                canCallMain: true,
                canStickMain: false,  // 初始设置为false
                commonMain: '2'
            },
            currentRound: [],
            bottomCards: [],
            isMainFixed: false,
            mainCallDeadline: Date.now() + 100000,
            counterMainDeadline: null,
            mainCalled: false,
            commonMain: '2'
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
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});