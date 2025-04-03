import React, { useState, useEffect, useCallback } from 'react';
import { 
    Box, 
    Center, 
    HStack, 
    Button, 
    Menu,
    MenuButton,
    MenuList,
    MenuItem,
    Text,
    Progress
} from '@chakra-ui/react';
import Card from './Card';
import GameInfo from './GameInfo';
import socket from '../../utils/socket';
import '../../cards.css';

function GameLayout() {
    // 基础状态
    const [playerCards, setPlayerCards] = useState([]); // 当前玩家手牌
    const [isDealing, setIsDealing] = useState(true);          // 是否在发牌中
    const [dealingProgress, setDealingProgress] = useState(0); // 发牌进度
    const [gamePhase, setGamePhase] = useState('pregame');     // 游戏阶段：'waiting'/'pregame'/'playing'/'aftergame'
    const [preGameState, setPreGameState] = useState({ isDealing: false, canCallMain: false }); // pregame 阶段的子状态
    
    // 游戏状态
    const [mainSuit, setMainSuit] = useState(null); // 当前主色
    const [mainCaller, setMainCaller] = useState(null); // 叫主的玩家
    const [mainCards, setMainCards] = useState(null); // 叫主的牌型
    const [mainCalled, setMainCalled] = useState(false); // 是否已经有人叫主
    
    // 操作状态
    const [selectedJoker, setSelectedJoker] = useState(null); // 'BIG' 或 'SMALL'
    const [selectedPair, setSelectedPair] = useState(null); // {suit: 'HEARTS', value: '5'}
    const [selectedConsecutivePair, setSelectedConsecutivePair] = useState(null);
    const [canCallMain, setCanCallMain] = useState(false);
    const [canStealMain, setCanStealMain] = useState(false);

    // 计算牌的权重（用于排序）
    const getCardWeight = useCallback((card) => {
        if (card.suit === 'JOKER') {
            return card.value === 'BIG' ? 10000 : 9999;
        }
    
        const suitWeights = {
            'HEARTS': 400,
            'SPADES': 300,
            'DIAMONDS': 200,
            'CLUBS': 100
        };
    
        const mainValues = ['5', '3', '2'];
        const normalValues = ['4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        
        let weight = suitWeights[card.suit];
        
        if (mainValues.includes(card.value)) {
            weight += (mainValues.indexOf(card.value) === 0 ? 3000 : 
                      mainValues.indexOf(card.value) === 1 ? 2000 : 1000);
        } else {
            weight += normalValues.indexOf(card.value) * 10;
        }
    
        return weight;
    }, []);

    // 排序牌
    const sortCards = useCallback((cards) => {
        return [...cards].sort((a, b) => getCardWeight(b) - getCardWeight(a));
    }, [getCardWeight]);

    // 检查是否有大小王
    const hasJoker = useCallback((value) => {
        return playerCards.some(card => 
            card.suit === 'JOKER' && card.value === value
        );
    }, [playerCards]);

    // 检查是否有大小王对子
    const hasJokerPair = useCallback((value) => {
        return playerCards.filter(card => 
            card.suit === 'JOKER' && card.value === value
        ).length === 2;
    }, [playerCards]);

    // 获取某花色的对子
    const getPairs = useCallback((suit) => {
        const pairs = {};
        playerCards.forEach(card => {
            if (card.suit === suit) {
                pairs[card.value] = (pairs[card.value] || 0) + 1;
            }
        });
        return Object.entries(pairs)
            .filter(([_, count]) => count >= 2)
            .map(([value]) => value);
    }, [playerCards]);

    // 处理大小王选择
    const handleJokerSelect = (value) => {
        setSelectedJoker(value);
        setSelectedPair(null);
    };

    // 处理对子选择
    const handlePairSelect = (suit, value) => {
        setSelectedPair({ suit, value });
    };

    // 处理叫主
    const handleCallMain = () => {
        if (canCallMain) {
            socket.emit('callMain', {
                roomId: localStorage.getItem('roomId'),
                mainSuit: selectedPair?.suit,
                mainCards: {
                    joker: selectedJoker,
                    pair: selectedPair
                }
            });
        }
    };

    // 监听服务器事件
    useEffect(() => {
        console.log('设置 socket 监听器');
        
        // 监听游戏开始
        socket.on('gameStart', () => {
            console.log('收到游戏开始事件');
            setGamePhase('pregame');
            setIsDealing(true);
            setDealingProgress(0);
            console.log('发送 clientReady 信号');
            socket.emit('clientReady');
        });
        
        // 监听单轮发牌
        socket.on('receiveCard', ({ card, cardIndex, totalCards }) => {
            console.log('收到一张牌:', card, '索引:', cardIndex);
            setPlayerCards(prev => {
                // 创建一个新数组，确保有足够的空间
                const newCards = Array.from({ length: totalCards }, (_, i) => prev[i] || null);
                // 将新牌放入对应位置
                newCards[cardIndex] = card;
                // 过滤掉空值并排序
                return sortCards(newCards.filter(Boolean));
            });
        });

        // 监听发牌进度
        socket.on('dealingProgress', ({ currentRound, totalRounds }) => {
            console.log(`发牌进度更新: ${currentRound}/${totalRounds}`);
            const progress = (currentRound / totalRounds) * 100;
            setDealingProgress(progress);
            if (currentRound === totalRounds) {
                console.log('发牌完成');
                setIsDealing(false);
                setDealingProgress(100);
            }
        });

        // 监听游戏状态更新
        socket.on('updateGameState', (gameState) => {
            console.log('游戏状态更新:', gameState);
            if (gameState.phase) {
                setGamePhase(gameState.phase);
            }
            
            if (gameState.preGameState) {
                setPreGameState(gameState.preGameState);
                setIsDealing(gameState.preGameState.isDealing);
                setCanCallMain(gameState.preGameState.canCallMain);
            }
        });

        // 监听叫主事件
        socket.on('mainCalled', ({ mainSuit, mainCaller, mainCards, stealMainDeadline }) => {
            console.log('有人叫主:', { mainSuit, mainCaller, mainCards });
            setMainSuit(mainSuit);
            setMainCaller(mainCaller);
            setMainCards(mainCards);
            setMainCalled(true);

            // 设置反主倒计时
            if (stealMainDeadline) {
                const countdownInterval = setInterval(() => {
                    const remainingTime = Math.max(0, Math.floor((stealMainDeadline - Date.now()) / 1000));
                    // 更新UI显示剩余时间
                    if (remainingTime <= 0) {
                        clearInterval(countdownInterval);
                    }
                }, 1000);
            }
        });

        return () => {
            console.log('清理 socket 监听器');
            socket.off('gameStart');
            socket.off('receiveCard');
            socket.off('dealingProgress');
            socket.off('updateGameState');
            socket.off('mainCalled');
        };
    }, [sortCards]);

    // 渲染界面
    return (
        <Box position="relative" h="100vh" bg="gray.100">
            <GameInfo 
                mainSuit={mainSuit}
                mainCaller={mainCaller}
                mainCards={mainCards}
                gamePhase={gamePhase}
                preGameState={preGameState}
            />

            {/* 发牌进度显示 */}
            {gamePhase === 'pregame' && preGameState.isDealing && (
                <Center position="absolute" top="50%" left="50%" transform="translate(-50%, -50%)">
                    <Box w="300px">
                        <Text mb={2} textAlign="center">发牌中... {Math.floor(dealingProgress)}%</Text>
                        <Progress value={dealingProgress} size="lg" colorScheme="blue" />
                    </Box>
                </Center>
            )}

            {/* 操作区域 */}
            <Center position="absolute" top="60%" left="50%" transform="translate(-50%, -50%)">
                <HStack spacing={4}>
                    {/* 大小王选择 */}
                    <HStack spacing={2}>
                        <Button
                            colorScheme={selectedJoker === 'BIG' ? 'green' : 'gray'}
                            onClick={() => handleJokerSelect('BIG')}
                            isDisabled={!hasJoker('BIG')}
                        >
                            大王
                            {hasJokerPair('BIG') && ' (对)'}
                        </Button>
                        <Button
                            colorScheme={selectedJoker === 'SMALL' ? 'green' : 'gray'}
                            onClick={() => handleJokerSelect('SMALL')}
                            isDisabled={!hasJoker('SMALL')}
                        >
                            小王
                            {hasJokerPair('SMALL') && ' (对)'}
                        </Button>
                    </HStack>

                        {/* 花色对子选择 */}
                        <HStack spacing={0}>
                            {['HEARTS', 'SPADES', 'DIAMONDS', 'CLUBS'].map((suit, index) => (
                                <Menu key={suit}>
                                    <MenuButton
                                        as={Button}
                                        colorScheme={selectedPair?.suit === suit ? 'green' : 'gray'}
                                        isDisabled={getPairs(suit).length === 0}
                                    >
                                        {suit === 'HEARTS' ? '♥' : 
                                         suit === 'SPADES' ? '♠' : 
                                         suit === 'DIAMONDS' ? '♦' : '♣'}
                                    </MenuButton>
                                    <MenuList>
                                        {getPairs(suit).map(value => (
                                            <MenuItem
                                                key={value}
                                                onClick={() => handlePairSelect(suit, value)}
                                            >
                                                {value}
                                            </MenuItem>
                                        ))}
                                    </MenuList>
                                </Menu>
                            ))}
                        </HStack>

                        {/* 叫主按钮 */}
                        <Button
                            colorScheme="blue"
                            onClick={handleCallMain}
                            isDisabled={!canCallMain}
                        >
                            叫主
                        </Button>
                    </HStack>
                </Center>
            

            {/* 玩家手牌区域 */}
            <Center 
                position="absolute" 
                bottom="5%" 
                left="50%" 
                transform="translateX(-50%)"
                maxW="90vw"
                overflow="visible"
            >
                <div className="player-hand">
                    {playerCards.map((card, index) => (
                        <div 
                            key={`${card.suit}-${card.value}-${index}`} 
                            style={{
                                position: 'relative',
                                display: 'inline-block',
                                marginRight: '-30px',
                            }}
                        >
                            <Card 
                                suit={card.suit}
                                value={card.value}
                                className="player-card"
                            />
                        </div>
                    ))}
                </div>
            </Center>
        </Box>
    );
}

export default GameLayout;