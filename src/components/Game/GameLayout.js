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
    const [canFixMain, setCanFixMain] = useState(false);    // 是否可以加固
    const [canCounterMain, setCanCounterMain] = useState(false); // 是否可以反主
    const [showFixButton, setShowFixButton] = useState(false); // 是否显示加固按钮
    const [showCounterButton, setShowCounterButton] = useState(false); // 是否显示反主按钮
    const [counterJoker, setCounterJoker] = useState(null); // 反主选中的王
    const [counterPair, setCounterPair] = useState(null); // 反主选中的对子

    // 添加一个新状态
    const [isMainFixed, setIsMainFixed] = useState(false);

    // 添加一个状态表示是否反主
    const [hasCounteredMain, setHasCounteredMain] = useState(false);

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

    // 添加新的函数来检查是否可以加固
    const checkCanFixMain = (usedJoker) => {
        console.log('检查是否可以加固，使用的王为:', usedJoker);
        // 检查是否有两张相同的王
        if (usedJoker) {
            const jokerCount = playerCards.filter(card => 
                card.suit === 'JOKER' && card.value === usedJoker
            ).length;
            console.log('找到相同的王数量:', jokerCount);
            setCanFixMain(jokerCount >= 2);
        } else {
            setCanFixMain(false);
        }
    };

    // 添加新的函数来检查是否可以反主
    const checkCanCounterMain = () => {
        // 检查是否有两张相同的王和一对牌
        const hasBigJokerPair = hasJokerPair('BIG');
        const hasSmallJokerPair = hasJokerPair('SMALL');
        const hasPair = Object.values(getPairs('HEARTS')).length > 0 || 
                       Object.values(getPairs('SPADES')).length > 0 || 
                       Object.values(getPairs('DIAMONDS')).length > 0 || 
                       Object.values(getPairs('CLUBS')).length > 0;
        
        setCanCounterMain((hasBigJokerPair || hasSmallJokerPair) && hasPair);
    };

    // 处理反主
    const handleCounterMain = () => {
        if (canCounterMain && counterJoker && counterPair) {
            socket.emit('counterMain', {
                roomId: localStorage.getItem('roomId'),
                mainSuit: counterPair.suit,
                mainCards: {
                    joker: counterJoker,
                    pair: counterPair
                }
            });
            
            // 本地先设置为已反主
            setHasCounteredMain(true);
        }
    };

    // 添加加固的处理
    const handleFixMain = () => {
        if (canFixMain && !isMainFixed) {
            socket.emit('fixMain', {
                roomId: localStorage.getItem('roomId')
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
            if (card.suit === 'JOKER' && card.value === 'BIG') {
                console.log('收到大王');
            }
            
            setPlayerCards(prev => {
                // 创建一个新数组，确保有足够的空间
                const newCards = Array.from({ length: totalCards }, (_, i) => prev[i] || null);
                // 将新牌放入对应位置
                newCards[cardIndex] = card;
                // 过滤掉空值并排序
                const updatedCards = sortCards(newCards.filter(Boolean));
                
                // 检查是否可以加固或反主
                if (mainCalled) {
                    if (mainCaller === socket.id) {
                        console.log('我是叫主玩家，检查是否可以加固');
                        console.log('使用的王:', mainCards?.joker);
                        checkCanFixMain(mainCards?.joker);
                    } else {
                        console.log('我是其他玩家，检查是否可以反主');
                        checkCanCounterMain();
                    }
                }
                
                return updatedCards;
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
            
            // 同步加固状态
            if (gameState.isMainFixed !== undefined) {
                setIsMainFixed(gameState.isMainFixed);
            }
        });

        // 监听叫主事件
        socket.on('mainCalled', ({ mainSuit, mainCaller, mainCards }) => {
            console.log('有人叫主:', { mainSuit, mainCaller, mainCards });
            setMainSuit(mainSuit);
            setMainCaller(mainCaller);
            setMainCards(mainCards);
            setMainCalled(true);
            
            // 检查当前玩家是否是叫主玩家
            if (mainCaller === socket.id) {
                console.log('我是叫主玩家');
                setShowFixButton(true);
                // 检查是否有另一张相同的王可以用来加固
                console.log('检查是否可以加固，使用的王:', mainCards?.joker);
                checkCanFixMain(mainCards?.joker);
            } else {
                // 是其他玩家，重置选择状态
                setSelectedJoker(null);
                setShowCounterButton(true);
                // 检查反主条件
                checkCanCounterMain();
            }
        });

        // 加固监听
        socket.on('mainFixed', (data) => {
            console.log('主花色已加固:', data);
            setCanCounterMain(false);
            setIsMainFixed(true);
            
            // 添加显示其他玩家的加固状态逻辑
            if (data.mainCaller !== socket.id) {
                // 其他玩家已加固，可以显示消息
                console.log(`玩家 ${data.mainCaller} 已加固主花色`);
            }
            
            setPreGameState(prev => ({
                ...prev,
                canStealMain: false
            }));
        });

        // 反主监听
        socket.on('mainCountered', ({ mainCaller, originalMainCaller, mainSuit, mainCards }) => {
            console.log('有人反主:', { mainCaller, originalMainCaller, mainSuit, mainCards });
            
            // 更新主叫者、主花色和牌型信息
            setMainCaller(mainCaller);
            setMainSuit(mainSuit);  // 设置为反主玩家的花色
            setMainCards(mainCards);
            
            // 任何人反主后，不可再加固
            setShowFixButton(false);
            setCanFixMain(false);
            
            // 如果当前玩家是反主玩家，设置为已反主
            if (socket.id === mainCaller) {
                setHasCounteredMain(true);
            }
            
            // 更新状态，不可再反主，但不要隐藏按钮
            setCanCounterMain(false);
            
            // 更新 preGameState
            setPreGameState(prev => ({
                ...prev,
                canStealMain: false
            }));
        });

        return () => {
            console.log('清理 socket 监听器');
            socket.off('gameStart');
            socket.off('receiveCard');
            socket.off('dealingProgress');
            socket.off('updateGameState');
            socket.off('mainCalled');
            socket.off('mainFixed');
            socket.off('mainCountered');
        };
    }, [sortCards, playerCards, mainCalled, mainCaller, mainCards]);

    // 渲染界面
    return (
        <Box position="relative" h="100vh" bg="gray.100">
            <GameInfo 
                mainSuit={mainSuit}
                mainCaller={mainCaller}
                mainCards={mainCards}
                gamePhase={gamePhase}
                preGameState={preGameState}
                isMainFixed={isMainFixed}
                hasCounteredMain={hasCounteredMain}
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
                {/* 未叫主状态下的叫主界面 */}
                {!mainCalled && preGameState.canCallMain && (
                    <HStack spacing={4}>
                        {/* 大小王选择 */}
                        <HStack spacing={2}>
                            <Button
                                colorScheme={selectedJoker === 'BIG' ? 'green' : 'gray'}
                                onClick={() => handleJokerSelect('BIG')}
                                isDisabled={!hasJoker('BIG')}
                            >
                                <Text color="red">大王</Text>
                            </Button>
                            <Button
                                colorScheme={selectedJoker === 'SMALL' ? 'green' : 'gray'}
                                onClick={() => handleJokerSelect('SMALL')}
                                isDisabled={!hasJoker('SMALL')}
                            >
                                小王
                            </Button>
                        </HStack>

                        {/* 花色对子选择 */}
                        <HStack spacing={0}>
                            {['HEARTS', 'SPADES', 'DIAMONDS', 'CLUBS'].map((suit) => (
                                <Menu key={suit}>
                                    <MenuButton
                                        as={Button}
                                        colorScheme={selectedPair?.suit === suit ? 'green' : 'gray'}
                                        isDisabled={getPairs(suit).length === 0}
                                    >
                                        {suit === 'HEARTS' ? '♥️' : 
                                         suit === 'SPADES' ? '♠️' : 
                                         suit === 'DIAMONDS' ? '♦️' : '♣️'}
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
                            isDisabled={!canCallMain || !selectedJoker || !selectedPair}
                        >
                            叫主
                        </Button>
                    </HStack>
                )}

                {/* 已叫主状态下 - 其他玩家的反主界面 */}
                {mainCalled && mainCaller !== socket.id && (showCounterButton || hasCounteredMain) && (
                    <HStack spacing={4}>
                        {/* 大小王选择和花色对子选择 - 仅在可反主时显示 */}
                        {preGameState.canStealMain && !hasCounteredMain && (
                            <>
                                {/* 大小王选择 */}
                                <HStack spacing={2}>
                                    <Button
                                        colorScheme={counterJoker === 'BIG' ? 'green' : 'gray'}
                                        onClick={() => setCounterJoker('BIG')}
                                        isDisabled={!hasJokerPair('BIG')}
                                    >
                                        <Text color="red">大王(对)</Text>
                                    </Button>
                                    <Button
                                        colorScheme={counterJoker === 'SMALL' ? 'green' : 'gray'}
                                        onClick={() => setCounterJoker('SMALL')}
                                        isDisabled={!hasJokerPair('SMALL')}
                                    >
                                        小王(对)
                                    </Button>
                                </HStack>

                                {/* 花色对子选择 */}
                                <HStack spacing={0}>
                                    {['HEARTS', 'SPADES', 'DIAMONDS', 'CLUBS'].map((suit) => (
                                        <Menu key={suit}>
                                            <MenuButton
                                                as={Button}
                                                colorScheme={counterPair?.suit === suit ? 'green' : 'gray'}
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
                                                        onClick={() => setCounterPair({ suit, value })}
                                                    >
                                                        {value}
                                                    </MenuItem>
                                                ))}
                                            </MenuList>
                                        </Menu>
                                    ))}
                                </HStack>
                            </>
                        )}

                        {/* 反主按钮 - 总是显示，但状态不同 */}
                        <Button
                            colorScheme={hasCounteredMain ? "gray" : "red"}
                            onClick={handleCounterMain}
                            isDisabled={hasCounteredMain || !preGameState.canStealMain || !canCounterMain || !counterJoker || !counterPair}
                        >
                            {hasCounteredMain ? "已反主" : "反主"}
                        </Button>
                    </HStack>
                )}

                {/* 已叫主状态下 - 叫主玩家的加固按钮 */}
                {mainCalled && mainCaller === socket.id && (showFixButton || isMainFixed) && (
                    <Button
                        colorScheme={isMainFixed ? "gray" : "green"}
                        onClick={handleFixMain}
                        isDisabled={isMainFixed || !preGameState.canStealMain || !canFixMain}
                    >
                        {isMainFixed ? "已加固" : "加固"}
                    </Button>
                )}
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