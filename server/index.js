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
    console.log(`Dealing round ${currentRound + 1}/${totalRounds}`);
    
    if (currentRound >= totalRounds) {
        console.log('All cards dealt');
        io.to(roomId).emit('updateGameState', {
            phase: 'callMain'
        });
        return;
    }

    // 给每个玩家发一张牌
    gameState.players.forEach((player, index) => {
        const card = player.cards[currentRound];
        console.log(`Sending card to player ${player.name}:`, card);
        
        io.to(player.id).emit('receiveCard', {
            card,
            cardIndex: currentRound,
            totalCards: totalRounds
        });
    });

    // 广播发牌进度
    io.to(roomId).emit('dealingProgress', {
        currentRound: currentRound + 1,
        totalRounds
    });

    // 延长每轮发牌的间隔
    setTimeout(() => {
        dealNextRound(gameState, roomId, currentRound + 1);
    }, 2000);  // 增加到2000ms
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
        const room = rooms.get(roomId);
        if (room && room.players.length < 4) {
            room.players.push({
                id: socket.id,
                ready: false,
                name: `玩家${socket.id.substr(0, 4)}`
            });
            socket.join(roomId);
            socket.emit('joinRoomSuccess', roomId);
            io.to(roomId).emit('roomInfo', room);
            io.emit('roomList', Array.from(rooms.values()));
        }
    });

    // 获取房间信息
    socket.on('getRoomInfo', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            socket.emit('roomInfo', room);
        }
    });

    // 准备/取消准备
    socket.on('toggleReady', (roomId) => {
        const room = rooms.get(roomId);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.ready = !player.ready;
                
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
                        phase: 'dealing',
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

                    // 等待客户端发送ready信号后再开始发牌
                    socket.once('clientReady', () => {
                        console.log('Client ready, starting to deal cards');
                        dealNextRound(gameState, roomId, 0);
                    });
                }
            }
        }
    });

    // 处理叫主
    socket.on('callMain', ({ roomId, mainSuit, mainCards }) => {
        console.log('Received callMain:', { roomId, mainSuit, mainCards });
        
        if (!roomId) {
            console.error('No roomId provided');
            socket.emit('callMainError', { error: 'No roomId provided' });
            return;
        }
        
        const gameState = games.get(roomId);
        console.log('Found gameState:', !!gameState, 'for roomId:', roomId);
        console.log('All available games:', Array.from(games.keys()));
        
        if (gameState && !gameState.mainCalled) {
            console.log('Setting main:', { mainSuit, mainCards });
            
            // 更新游戏状态
            gameState.mainSuit = mainSuit;
            gameState.mainCaller = socket.id;
            gameState.mainCards = mainCards;
            gameState.mainCalled = true;
            gameState.counterMainDeadline = Date.now() + 10000; // 10秒反主时间
            
            // 通知所有玩家
            io.to(roomId).emit('mainCalled', {
                mainSuit,
                mainCaller: socket.id,
                mainCards,
                counterMainDeadline: gameState.counterMainDeadline
            });
            
            console.log('Updated game state:', gameState);
        } else {
            console.log('Cannot call main:', { 
                hasGameState: !!gameState, 
                alreadyCalled: gameState?.mainCalled,
                availableRooms: Array.from(rooms.keys())
            });
            
            socket.emit('callMainError', { 
                error: gameState ? 'Main already called' : 'Game not found',
                availableRooms: Array.from(rooms.keys()),
                availableGames: Array.from(games.keys()),
                roomId
            });
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
        // 创建一个新房间
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
        rooms.set(roomId, {
            id: roomId,
            players: players
        });
        
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
            phase: 'dealing',
            currentRound: [],
            bottomCards: [],
            isMainFixed: false,
            mainCallDeadline: Date.now() + 100000,
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
        
        // 确保客户端先收到 roomId
        socket.emit('testGameCreated', { 
            roomId,
            message: '测试模式：已自动添加3个机器人玩家，您可以随时返回大厅'
        });
        
        // 通知玩家游戏开始
        io.to(roomId).emit('gameStart');
        
        // 等待客户端发送 ready 信号后再开始发牌
        socket.once('clientReady', () => {
            console.log('Client ready, starting to deal cards for test game');
            dealNextRound(gameState, roomId, 0);
        });
    });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});