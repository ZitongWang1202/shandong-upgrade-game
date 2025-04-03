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
            canCallMain: true
        };
        io.to(roomId).emit('updateGameState', {
            phase: 'pregame',
            preGameState: gameState.preGameState
        });
    }

    if (currentRound >= totalRounds) {
        console.log('All cards dealt');
        gameState.preGameState.isDealing = false;
        io.to(roomId).emit('updateGameState', {
            phase: 'pregame',
            preGameState: gameState.preGameState
        });
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
                    canCallMain: true      // 是否可以叫主
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
            
            // 更新 preGameState
            gameState.preGameState = {
                ...gameState.preGameState,
                canCallMain: false,    // 不能再直接叫主
                canStealMain: true,    // 可以反主
                stealMainDeadline: Date.now() + 10000  // 反主截止时间
            };
            
            // 通知所有玩家主花色已经被叫出
            io.to(roomId).emit('mainCalled', {
                mainSuit,
                mainCaller: socket.id,
                mainCards,
                stealMainDeadline: gameState.preGameState.stealMainDeadline
            });
            
            // 通知所有玩家游戏状态已更新
            io.to(roomId).emit('updateGameState', {
                phase: 'pregame',
                preGameState: gameState.preGameState
            });

            // 设置反主时间结束的定时器
            setTimeout(() => {
                // 10秒后，结束反主阶段
                gameState.preGameState = {
                    ...gameState.preGameState,
                    canStealMain: false  // 不能再反主
                };
                
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: gameState.preGameState
                });
                
                // 这里可以添加进入下一阶段的逻辑
                // 例如，进入粘牌阶段或直接开始游戏
            }, 10000);
        }
    });

    // 处理加固
    socket.on('fixMain', ({ roomId }) => {
        const gameState = games.get(roomId);
        if (gameState && gameState.mainCaller === socket.id) {
            gameState.isMainFixed = true;
            io.to(roomId).emit('mainFixed');
        }
    });

    // 处理反主
    socket.on('counterMain', ({ roomId, mainCards }) => {
        const gameState = games.get(roomId);
        if (gameState && 
            !gameState.isMainFixed && 
            Date.now() <= gameState.counterMainDeadline) {
            
            gameState.mainCaller = socket.id;
            gameState.mainCards = mainCards;
            gameState.counterMainDeadline = Date.now() + 10000;

            io.to(roomId).emit('mainCountered', {
                mainCaller: socket.id,
                mainCards,
                counterMainDeadline: gameState.counterMainDeadline
            });
        }
    });

    // 抢主
    socket.on('stealMain', ({ roomId, mainCards }) => {
        const gameState = games.get(roomId);
        if (gameState && gameState.currentTurn === socket.id) {
            gameState.mainCaller = socket.id;
            gameState.mainCards = mainCards;
            
            // 通知所有玩家
            io.to(roomId).emit('mainStolen', {
                mainCaller: socket.id,
                mainCards
            });

            // 更新当前回合
            const currentPlayerIndex = gameState.players.findIndex(p => p.id === socket.id);
            gameState.currentTurn = gameState.players[(currentPlayerIndex + 1) % 4].id;
            io.to(roomId).emit('updateGameState', {
                currentTurn: gameState.currentTurn
            });
        }
    });

    // 粘主
    socket.on('stickCards', ({ roomId, cards }) => {
        const gameState = games.get(roomId);
        if (gameState && gameState.phase === 'stealMain') {
            // 验证粘主的合法性
            // ...

            // 通知所有玩家
            io.to(roomId).emit('cardsStuck', {
                playerId: socket.id,
                cards
            });
        }
    });

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
            mainCalled: false
        };

        // 预先准备好牌，但不立即分配
        const preparedCards = {
            player: [
                { suit: 'JOKER', value: 'BIG' },  // 大王
                { suit: 'HEARTS', value: 'A' },    // 红桃A
                { suit: 'HEARTS', value: 'A' }     // 红桃A
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
                    canCallMain: true
                };
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: gameState.preGameState
                });
            }

            if (currentRound >= totalRounds) {
                console.log('All cards dealt');
                io.to(roomId).emit('updateGameState', {
                    phase: 'pregame',
                    preGameState: gameState.preGameState
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
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});