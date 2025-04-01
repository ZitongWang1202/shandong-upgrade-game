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
    const [isDealing, setIsDealing] = useState(true); // 是否在发牌中
    const [dealingProgress, setDealingProgress] = useState(0); // 发牌进度
    
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
        
        // 监听单轮发牌
        socket.on('receiveCard', ({ card, cardIndex, totalCards }) => {
            console.log('收到一张牌:', card);
            setPlayerCards(prev => {
                const newCards = [...prev];
                newCards[cardIndex] = card;
                return sortCards(newCards.filter(Boolean));
            });
        });

        // 监听发牌进度
        socket.on('dealingProgress', ({ currentRound, totalRounds }) => {
            const progress = (currentRound / totalRounds) * 100;
            setDealingProgress(progress);
            console.log(`发牌进度: ${currentRound}/${totalRounds}`);
            if (currentRound === totalRounds) {
                setIsDealing(false);
            }
        });

        // 监听游戏状态更新
        socket.on('updateGameState', (gameState) => {
            if (gameState.phase) {
                // 处理游戏阶段更新
            }
        });

        return () => {
            console.log('清理 socket 监听器');
            socket.off('receiveCard');
            socket.off('dealingProgress');
            socket.off('updateGameState');
        };
    }, [sortCards]);

    // 渲染界面
    return (
        <Box position="relative" h="100vh" bg="gray.100">
            <GameInfo 
                mainSuit={mainSuit}
                mainCaller={mainCaller}
                mainCards={mainCards}
            />

            {/* 发牌进度显示 */}
            {isDealing && (
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