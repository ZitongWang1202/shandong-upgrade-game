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

// 导入工具函数
const { 
    handleBotPlay, 
    endRound, 
    createDeck, 
    shuffleDeck, 
    getPlayerTeam, 
    determineBottomDealer,
    exchangeCards
} = require('./gameUtils');


const createBotFixTest = require('./tests/createBotFixTestGame');
const createBottomTest = require('./tests/createBottomTestGame');
const createCounterTest = require('./tests/createCounterTestGame');
const createFixTest = require('./tests/createFixTestGame');
const createPlayingTest = require('./tests/createPlayingTestGame');
const createStickTest = require('./tests/createStickTestGame');
const createTestGame = require('./tests/createTestGame');
const createFollowTestGame = require('./tests/createFollowTestGame');

app.use(cors());

const rooms = new Map();
const games = new Map();

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

    // 导入各个测试模式，传入所需的工具函数
    createPlayingTest(socket, io, games, rooms, { createDeck, shuffleDeck, handleBotPlay, endRound });
    createFixTest(socket, io, games, rooms, { createDeck, shuffleDeck, handleBotPlay, endRound });
    createCounterTest(socket, io, games, rooms, { createDeck, shuffleDeck, handleBotPlay, endRound });
    createBotFixTest(socket, io, games, rooms, { createDeck, shuffleDeck, handleBotPlay, endRound });
    createStickTest(socket, io, games, rooms, { createDeck, shuffleDeck, handleBotPlay, endRound });
    createBottomTest(socket, io, games, rooms, { createDeck, shuffleDeck, handleBotPlay, endRound });
    createTestGame(socket, io, games, rooms, { createDeck, shuffleDeck, handleBotPlay, endRound });
    createFollowTestGame(socket, io, games, rooms, { createDeck, shuffleDeck, handleBotPlay, endRound });

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

            // 在 gameStart 之前，再次发送最终确认的房间/玩家信息
            console.log('Emitting final roomInfo before gameStart');
            io.to(roomId).emit('roomInfo', room);
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

    // 辅助函数：获取领出牌信息
    function getLeadingPlay(roundCards) {
        if (!roundCards || roundCards.length === 0) {
            return null;
        }
        // TODO: 如果客户端需要，稍后分析 roundCards[0].cards 的牌型
        return roundCards[0]; // 返回第一个出牌的对象 { player, cards }
    }

    // 修改 confirmBottomDeal 以正确初始化出牌阶段
    socket.on('confirmBottomDeal', ({ roomId, putCards }) => {
        const gameState = games.get(roomId);
        const room = rooms.get(roomId);
        // ... (验证 gameState, gameState.bottomDealer 是否等于 socket.id, putCards.length, room) ...
        if (!gameState || gameState.bottomDealer !== socket.id || putCards.length !== 4 || !room) {
            console.log('无效的抠底请求或房间未找到');
            // 处理错误
            socket.emit('bottomDealError', { message: '无效的操作或房间信息' });
            return;
        }

        console.log('玩家放入的底牌:', putCards);

        // 找到执行抠底操作的玩家对象
        const playerWhoDealtBottom = gameState.players.find(p => p.id === socket.id); // <-- 使用这个变量名
        if (!playerWhoDealtBottom) { // <-- 检查是否找到了玩家
            console.log('无法在游戏状态中找到抠底玩家对象');
            socket.emit('bottomDealError', { message: '找不到玩家信息' });
            return;
        }

        // 更新底牌
        gameState.bottomCards = putCards;

        // 从玩家手牌中移除这些牌 (使用 playerWhoDealtBottom)
        playerWhoDealtBottom.cards = playerWhoDealtBottom.cards.filter(card =>
            !putCards.some(pc => pc.suit === card.suit && pc.value === card.value && pc.bottomId === card.bottomId) // Use bottomId if available for uniqueness
            || !putCards.some(pc => pc.suit === card.suit && pc.value === card.value && !card.bottomId && !pc.bottomId) // Fallback for cards without bottomId
        );

        console.log('抠底后玩家剩余的牌数量:', playerWhoDealtBottom.cards.length); // <-- 使用 playerWhoDealtBottom

        console.log('在改变阶段到 playing 前发送 roomInfo');
        io.to(roomId).emit('roomInfo', room);

        // 进入出牌阶段
        gameState.phase = 'playing';
        const bottomDealerIndex = gameState.players.findIndex(p => p.id === gameState.bottomDealer); // 这里 gameState.bottomDealer 是 ID
        gameState.currentPlayer = gameState.players[(bottomDealerIndex + 1) % 4].id; // 抠底玩家的下家开始
        gameState.firstPlayerInRound = gameState.currentPlayer; // 标记第一个出牌的玩家
        gameState.roundCards = []; // 初始化/清空第一轮的牌

        console.log('改变游戏阶段到 playing. 当前玩家:', gameState.currentPlayer);

        // 发送游戏阶段更新
        io.to(roomId).emit('gamePhaseChanged', {
            phase: 'playing',
            currentPlayer: gameState.currentPlayer
        });

        // 发送轮到谁出牌
        const nextPlayer = gameState.players.find(p => p.id === gameState.currentPlayer);
        io.to(roomId).emit('playerTurn', {
            player: gameState.currentPlayer,
            playerName: nextPlayer?.name,
            isFirstPlayer: true, // 这是游戏的第一轮第一个出牌者
            leadingPlay: null   // 还没有领出的牌
        });

        // !! 使用正确的变量名 playerWhoDealtBottom !!
        socket.emit('updatePlayerCards', playerWhoDealtBottom.cards); // <-- 修复：使用正确的变量名

        // 如果需要，触发机器人出牌
        if (nextPlayer && nextPlayer.isBot) {
            handleBotPlay(nextPlayer, gameState, roomId, io, endRound);
        }
    });

    // 修改 playCards 处理器
    socket.on('playCards', (data) => {
        console.log('收到出牌请求:', data);
        const gameState = games.get(data.roomId);
        const room = rooms.get(data.roomId); // 获取房间信息以获取名字等
        // ... (验证: gameState, currentPlayer 是否匹配 socket.id, room) ...
        if (!gameState || gameState.currentPlayer !== socket.id || !room) { /* ... 错误处理 ... */ return; }

        const currentPlayerIndex = gameState.players.findIndex(p => p.id === socket.id);
        const currentPlayer = gameState.players[currentPlayerIndex];
        if (!currentPlayer) { /* ... 错误处理 ... */ return; }

        const playedCards = data.cards;

        // --- 服务器端验证 (基础 - 稍后需要更多) ---
        // 1. 检查玩家是否有这些牌 (已部分完成)
        // 2. 根据 leadingPlay 检查出牌是否合法 (如果不是第一个出牌者)
        const isFirst = gameState.firstPlayerInRound === socket.id;
        const leadingPlay = getLeadingPlay(gameState.roundCards);

        if (!isFirst && leadingPlay) {
            if (playedCards.length !== leadingPlay.cards.length) {
                console.log(`出牌被拒绝：牌数错误。需要 ${leadingPlay.cards.length} 张, 实际 ${playedCards.length} 张`);
                socket.emit('playError', { message: `出牌数量错误，需要出 ${leadingPlay.cards.length} 张` });
                return; // 拒绝出牌
            }
            // TODO: 稍后添加更复杂的服务器端跟牌验证
        } else if (isFirst) {
            // TODO: 稍后添加服务器端领出验证 (是否是有效牌型?)
        }

        // --- 更新游戏状态 ---
        // 从手牌移除牌 (如果存在重复牌，确保唯一性)
         let cardsToRemove = [...playedCards];
         currentPlayer.cards = currentPlayer.cards.filter(cardInHand => {
             const indexToRemove = cardsToRemove.findIndex(cardToRemove =>
                 cardToRemove.suit === cardInHand.suit && cardToRemove.value === cardInHand.value
             );
             if (indexToRemove !== -1) {
                 cardsToRemove.splice(indexToRemove, 1); // 从待移除列表中移除一个实例
                 return false; // 从手牌中过滤掉这张牌
             }
             return true; // 保留这张手牌
         });


        // 将出的牌添加到 roundCards
        gameState.roundCards.push({
            player: socket.id,
            cards: playedCards
        });

        // 通知客户端
        io.to(data.roomId).emit('cardPlayed', {
            player: socket.id,
            cards: playedCards,
            playerName: currentPlayer.name
        });
        socket.emit('updatePlayerCards', currentPlayer.cards); // 更新当前玩家的手牌

        // --- 决定下一个玩家 ---
        const nextPlayerIndex = (currentPlayerIndex + 1) % gameState.players.length;
        const nextPlayer = gameState.players[nextPlayerIndex];

        // 检查本轮是否结束
        if (nextPlayer.id === gameState.firstPlayerInRound) {
            // 本轮结束逻辑
            console.log("本轮结束。正在确定赢家...");
            // TODO: 实现 determineRoundWinner 函数，基于 gameState.roundCards
            const winnerInfo = determineRoundWinner(gameState.roundCards, gameState.mainSuit, gameState.commonMain); // 占位符
            console.log("本轮赢家:", winnerInfo);

            gameState.currentPlayer = winnerInfo.winnerId; // 赢家开始下一轮
            gameState.firstPlayerInRound = winnerInfo.winnerId; // 标记新的首个出牌者
            gameState.roundCards = []; // 为下一轮清空牌

            io.to(data.roomId).emit('roundEnd', { // 通知本轮结束
                winner: winnerInfo.winnerId,
                winnerName: gameState.players.find(p => p.id === winnerInfo.winnerId)?.name,
                nextPlayer: winnerInfo.winnerId // 赢家领出下一轮
            });

            // 为赢家发送 playerTurn (开始新一轮)
            io.to(data.roomId).emit('playerTurn', {
                player: gameState.currentPlayer,
                playerName: gameState.players.find(p => p.id === gameState.currentPlayer)?.name,
                isFirstPlayer: true, // 赢家是新一轮的第一个出牌者
                leadingPlay: null   // 没有领出的牌
            });

        } else {
            // 本轮继续
            gameState.currentPlayer = nextPlayer.id; // 设置下一个玩家
            const currentLeadingPlay = getLeadingPlay(gameState.roundCards); // 获取实际的领出牌信息

            io.to(data.roomId).emit('playerTurn', {
                player: gameState.currentPlayer,
                playerName: nextPlayer.name,
                isFirstPlayer: false, // 不是第一个出牌者
                leadingPlay: currentLeadingPlay // ** 发送领出牌信息 **
            });
        }

        // 如果需要，为 *实际的* 下一个玩家触发机器人出牌
        const actualNextPlayer = gameState.players.find(p => p.id === gameState.currentPlayer);
        if (actualNextPlayer && actualNextPlayer.isBot) {
            // 确保机器人如果需要，可以访问 leadingPlay
            handleBotPlay(actualNextPlayer, gameState, data.roomId, io, endRound);
        }
    });

    // 本轮赢家逻辑的占位符 - 非常重要，需要正确实现
    function determineRoundWinner(roundCards, mainSuit, commonMain) {
        // 需要根据领出花色、是否毙牌等来比较牌的大小
        // 返回 { winnerId: string, winningCards: Card[] }
        console.warn("determineRoundWinner 逻辑是占位符!");
        if (!roundCards || roundCards.length === 0) return { winnerId: null, winningCards: [] };
        // 过于简化的占位符：最后一个出牌者赢 (不正确)
        const lastPlay = roundCards[roundCards.length - 1];
         return { winnerId: lastPlay.player, winningCards: lastPlay.cards };

        // TODO: 实现真实的比较逻辑，基于规则:
        // 1. 找到领出花色/牌型。
        // 2. 识别主牌（毙牌）。
        // 3. 在胜出类别中比较大小（主牌 > 领出花色 > 垫牌）。
        // 4. 处理相同大小（先出者为大）。
    }
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});