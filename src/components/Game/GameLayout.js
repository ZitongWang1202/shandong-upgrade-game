import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
    Progress,
    VStack
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
    const [preGameState, setPreGameState] = useState({ 
        isDealing: false, 
        canCallMain: false,
        canStickMain: false,  // 添加是否可以粘主的状态
        stickMainDeadline: null,  // 添加粘主截止时间
    }); 
    
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

    // 添加状态来跟踪时间限制
    const [callMainDeadline, setCallMainDeadline] = useState(null);
    const [stealMainDeadline, setStealMainDeadline] = useState(null);
    const [callMainTimeLeft, setCallMainTimeLeft] = useState(null);
    const [stealMainTimeLeft, setStealMainTimeLeft] = useState(null);

    // 添加新状态
    const [isMainCaller, setIsMainCaller] = useState(false);

    // 添加常主状态
    const [commonMain, setCommonMain] = useState('2');

    // 添加新的状态
    const [canStickCards, setCanStickCards] = useState(false);  // 是否可以粘牌
    const [hasStickCards, setHasStickCards] = useState(false);  // 是否已经粘牌
    const [isStickPhase, setIsStickPhase] = useState(false);    // 是否在粘牌阶段
    const [mainCallerCards, setMainCallerCards] = useState(null); // 叫主玩家的牌
    const [selectedStickCards, setSelectedStickCards] = useState({
        commonMain: null,  // 选中的常主/固定常主
        suitCards: []      // 选中的同花色牌
    });

    // 添加粘主倒计时状态
    const [stickMainTimeLeft, setStickMainTimeLeft] = useState(null);
    const [stickMainDeadline, setStickMainDeadline] = useState(null);

    // 在状态部分添加新的状态
    const [selectedCards, setSelectedCards] = useState([]);
    const [maxSelectableCards, setMaxSelectableCards] = useState(0);
    const [cardSelectionValidator, setCardSelectionValidator] = useState(null);

    // 添加抠底相关状态
    const [isBottomDealer, setIsBottomDealer] = useState(false);
    const [bottomCards, setBottomCards] = useState([]);
    const [selectedBottomCards, setSelectedBottomCards] = useState([]);
    const [bottomDealDeadline, setBottomDealDeadline] = useState(null);
    const [bottomDealTimeLeft, setBottomDealTimeLeft] = useState(null);

    // 在 GameLayout.js 中添加一个新的状态来跟踪来自底牌的牌
    const [cardsFromBottom, setCardsFromBottom] = useState([]);

    // 在组件顶部添加新的状态
    const [interactedBottomCards, setInteractedBottomCards] = useState(new Set());

    // 在 GameLayout.js 中添加新的状态
    const [isMyTurn, setIsMyTurn] = useState(false);
    const [currentPlayer, setCurrentPlayer] = useState(null);

    // 卡牌选择验证器对象
    const validators = useMemo(() => ({
        stickPhase: (card, currentSelected) => {
            // 如果已经选了3张牌，不能再选
            if (currentSelected.length >= 3) return false;
            
            // 如果还没有选牌，第一张必须是常主或固定常主
            if (currentSelected.length === 0) {
                return card.value === commonMain || ['2', '3', '5'].includes(card.value);
            }
            
            // 如果已经选了一张牌，接下来两张必须是主花色的牌
            return card.suit === mainSuit && currentSelected.length < 3;
        },
        gaming: (card, currentSelected) => {
            // 添加调试日志
            console.log('Gaming validator called with:', {
                isMyTurn,
                card,
                currentSelectedLength: currentSelected.length
            });
            
            // 如果不是自己的回合，不能出牌
            if (!isMyTurn) {
                console.log('Cannot select card: not my turn');
                return false;
            }
            
            // 在游戏初期，简单实现为允许选择任意牌，最多3张
            const canSelect = currentSelected.length < 3;
            console.log('Can select card:', canSelect);
            return canSelect;
        }
    }), [isMyTurn, commonMain, mainSuit]);

    // 计算牌的权重（用于排序）
    const getCardWeight = useCallback((card) => {
        // 大小王权重
        if (card.suit === 'JOKER') {
            return card.value === 'BIG' ? 10000 : 9999;
        }

        const suitWeights = {
            'HEARTS': 400,
            'SPADES': 300,
            'DIAMONDS': 200,
            'CLUBS': 100
        };

        // 基础权重
        let weight = suitWeights[card.suit];

        // 如果是当前常主
        if (card.value === preGameState.commonMain) {
            return 9000 + weight;  // 放在大小王之后
        }

        // 常主牌的权重计算
        const commonMainValues = ['5', '3', '2'];  // 固定常主
        const normalValues = ['4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        
        // 固定常主的权重计算（5、3、2的顺序）
        if (commonMainValues.includes(card.value)) {
            const valueIndex = commonMainValues.indexOf(card.value);
            const baseWeight = 9000 - valueIndex * 100; // 5是9000，3是8900，2是8800
            
            if (card.suit === mainSuit) {
                return baseWeight; // 主花色的固定常主
            } else {
                return baseWeight - 50; // 副花色的固定常主
            }
        }
        
        // 普通牌
        if (normalValues.includes(card.value)) {
            weight += normalValues.indexOf(card.value) * 10;
        }

        return weight;
    }, [mainSuit, preGameState.commonMain]);

    // 排序牌
    const sortCards = useCallback((cards) => {
        console.log('排序函数收到的牌数量:', cards.length);
        console.log('排序前的牌:', JSON.stringify(cards));
        
        if (!cards || !Array.isArray(cards)) {
            console.error('排序函数收到的不是数组');
            return [];
        }
        
        const sortedCards = [...cards].sort((a, b) => getCardWeight(b) - getCardWeight(a));
        console.log('排序后的牌数量:', sortedCards.length);
        console.log('排序后的牌:', JSON.stringify(sortedCards));
        
        return sortedCards;
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
    const checkCanFixMain = useCallback((usedJoker) => {
        console.log('检查是否可以加固，使用的王为:', usedJoker);
        // 如果没有使用王牌叫主，则不能加固
        if (!usedJoker) {
            setCanFixMain(false);
            return;
        }
        
        // 检查是否有两张相同的王
        const jokerCount = playerCards.filter(card => 
            card.suit === 'JOKER' && card.value === usedJoker
        ).length;
        
        console.log('找到相同的王数量:', jokerCount);
        
        // 只有在有两张相同的王，并且游戏状态允许加固时才能加固
        setCanFixMain(jokerCount >= 2 && preGameState.canStealMain && !isMainFixed);
    }, [playerCards, preGameState.canStealMain, isMainFixed]);

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

    // 添加检查是否可以粘牌的函数
    const checkCanStickCards = useCallback(() => {
        // 如果是叫主玩家或已经有人粘牌，则不能粘牌
        if (mainCaller === socket.id || hasStickCards) {
            setCanStickCards(false);
            return;
        }

        // 检查是否有王
        const hasJoker = playerCards.some(card => card.suit === 'JOKER');
        if (!hasJoker) {
            setCanStickCards(false);
            return;
        }

        // 检查是否有连对
        const suitPairs = {};
        playerCards.forEach(card => {
            if (card.suit !== 'JOKER') {
                if (!suitPairs[card.suit]) {
                    suitPairs[card.suit] = {};
                }
                suitPairs[card.suit][card.value] = (suitPairs[card.suit][card.value] || 0) + 1;
            }
        });

        // 检查每个花色是否有连对
        const hasConsecutivePair = Object.values(suitPairs).some(suitCards => {
            const values = Object.entries(suitCards)
                .filter(([_, count]) => count >= 2)
                .map(([value]) => value);
            
            // 检查是否有相邻的值
            for (let i = 0; i < values.length - 1; i++) {
                const currentValue = values[i];
                const nextValue = values[i + 1];
                if (isConsecutive(currentValue, nextValue)) {
                    return true;
                }
            }
            return false;
        });

        setCanStickCards(hasJoker && hasConsecutivePair);
    }, [playerCards, mainCaller, hasStickCards]);

    // 判断两个牌值是否相邻
    const isConsecutive = (value1, value2) => {
        const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        const index1 = values.indexOf(value1);
        const index2 = values.indexOf(value2);
        return Math.abs(index1 - index2) === 1;
    };

    // 处理粘牌按钮点击
    const handleStickCards = () => {
        if (canStickCards) {
            socket.emit('stickCards', {
                roomId: localStorage.getItem('roomId')
            });
            setHasStickCards(true);
        }
    };

    // 处理选择要交换的牌
    const handleSelectStickCards = (card) => {
        if (!isStickPhase || hasStickCards) return;

        // 如果点击已选中的牌，则取消选择
        if (selectedStickCards.commonMain && 
            selectedStickCards.commonMain.suit === card.suit && 
            selectedStickCards.commonMain.value === card.value) {
            setSelectedStickCards(prev => ({
                ...prev,
                commonMain: null
            }));
            return;
        }

        if (selectedStickCards.suitCards.some(c => 
            c.suit === card.suit && c.value === card.value)) {
            setSelectedStickCards(prev => ({
                ...prev,
                suitCards: prev.suitCards.filter(c => 
                    !(c.suit === card.suit && c.value === card.value))
            }));
            return;
        }

        // 如果是常主或固定常主
        if (card.value === commonMain || ['2', '3', '5'].includes(card.value)) {
            setSelectedStickCards(prev => ({
                ...prev,
                commonMain: card
            }));
        }
        // 如果是主花色的牌且还没选够两张
        else if (card.suit === mainSuit && selectedStickCards.suitCards.length < 2) {
            setSelectedStickCards(prev => ({
                ...prev,
                suitCards: [...prev.suitCards, card]
            }));
        }
    };

    // 修改通用的卡牌选择处理函数
    const handleCardSelect = (card) => {
        console.log('Card clicked:', card, 'gamePhase:', gamePhase, 'isMyTurn:', isMyTurn);
        
        // 如果是抠底阶段
        if (gamePhase === 'bottomDeal' && isBottomDealer) {
            handleBottomCardSelect(card);
            return;
        }

        // 出牌阶段
        if (gamePhase === 'playing') {
            console.log('In playing phase, validator:', cardSelectionValidator ? 'exists' : 'null');
        }

        // 原有的选牌逻辑
        if (!cardSelectionValidator) {
            console.log('No card selection validator');
            return;
        }

        const cardIndex = playerCards.findIndex(c => c === card);
        console.log('Card index:', cardIndex);
        
        const isCardSelected = selectedCards.some(c => {
            const selectedIndex = playerCards.findIndex(pc => pc === c);
            return selectedIndex === cardIndex;
        });
        
        console.log('Is card already selected:', isCardSelected);

        if (isCardSelected) {
            // 取消选中
            setSelectedCards(prev => 
                prev.filter(c => {
                    const selectedIndex = playerCards.findIndex(pc => pc === c);
                    return selectedIndex !== cardIndex;
                })
            );
        } else {
            const canSelectCard = cardSelectionValidator(card, selectedCards);
            console.log('Can select card according to validator:', canSelectCard);
            
            if (canSelectCard) {
                setSelectedCards(prev => [...prev, card]);
            }
        }
    };

    // 修改进入粘牌阶段的逻辑
    useEffect(() => {
        if (gamePhase === 'stickPhase') {
            setMaxSelectableCards(3);
            setCardSelectionValidator(() => validators.stickPhase);
        } else if (gamePhase === 'playing') {
            setMaxSelectableCards(3);
            setCardSelectionValidator(() => validators.gaming);
        } else if (gamePhase === 'gaming') {
            setMaxSelectableCards(3);
            setCardSelectionValidator(() => validators.gaming);
        } else {
            setMaxSelectableCards(0);
            setCardSelectionValidator(null);
        }
    }, [gamePhase, mainSuit, commonMain, validators]);

    // 修改确认交换的处理函数
    const handleConfirmStickCards = () => {
        if (selectedCards.length === 3) {
            const commonMainCard = selectedCards[0];
            const suitCards = selectedCards.slice(1);
            
            socket.emit('confirmStickCards', {
                roomId: localStorage.getItem('roomId'),
                cards: {
                    commonMain: commonMainCard,
                    suitCards: suitCards
                }
            });

            // 清理相关状态
            setStickMainTimeLeft(null);
            setCanStickCards(false);
        }
    };

    // 将监听器设置分离为专门的useEffect，不依赖频繁变化的状态
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
            console.log('收到一张牌:', card, '索引:', cardIndex, '总牌数:', totalCards);
            
            setPlayerCards(prev => {
                // 创建一个新数组，保留所有现有牌，包括底牌
                const updatedCards = [...prev];
                
                // 如果索引在合理范围内，直接更新
                if (cardIndex >= 0 && cardIndex < totalCards) {
                    // 保留所有isFromBottom标记的牌
                    const bottomCards = prev.filter(c => c.isFromBottom);
                    
                    // 把这张新牌放到正确的位置
                    const normalCards = prev.filter(c => !c.isFromBottom);
                    if (cardIndex < normalCards.length) {
                        normalCards[cardIndex] = card;
                    } else {
                        // 如果索引超出范围，直接添加
                        normalCards.push(card);
                    }
                    
                    // 合并普通牌和底牌，并排序
                    return sortCards([...normalCards, ...bottomCards]);
                }
                
                // 直接添加到牌组末尾并排序
                updatedCards.push(card);
                return sortCards(updatedCards);
            });
        });

        // 监听发牌进度
        socket.on('dealingProgress', ({ currentRound, totalRounds }) => {
            // console.log(`发牌进度更新: ${currentRound}/${totalRounds}`);
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
                // 如果进入粘牌阶段，设置相关状态
                if (gameState.phase === 'stickPhase') {
                    setIsStickPhase(true);
                }
            }
            
            if (gameState.preGameState) {
                setPreGameState(gameState.preGameState);
                setIsDealing(gameState.preGameState.isDealing);
                setCanCallMain(gameState.preGameState.canCallMain);
                
                // 添加常主更新
                if (gameState.preGameState.commonMain) {
                    setCommonMain(gameState.preGameState.commonMain);
                }
                
                // 处理叫主截止时间
                if (gameState.preGameState.callMainDeadline) {
                    setCallMainDeadline(gameState.preGameState.callMainDeadline);
                }
                
                // 处理反主截止时间
                if (gameState.preGameState.stealMainDeadline) {
                    setStealMainDeadline(gameState.preGameState.stealMainDeadline);
                }

                // 处理粘牌状态
                if (gameState.preGameState.canStickMain !== undefined) {
                    setCanStickCards(gameState.preGameState.canStickMain);
                }
                
                // 处理粘牌截止时间
                if (gameState.preGameState.stickMainDeadline) {
                    setStickMainDeadline(gameState.preGameState.stickMainDeadline);
                }
            }
            
            // 同步加固状态
            if (gameState.isMainFixed !== undefined) {
                setIsMainFixed(gameState.isMainFixed);
            }
        });

        // 监听叫主事件
        socket.on('mainCalled', ({ mainSuit, mainCaller, mainCards, stealMainDeadline }) => {
            console.log('有人叫主:', { mainSuit, mainCaller, mainCards, stealMainDeadline });
            setMainSuit(mainSuit);
            setMainCaller(mainCaller);
            setMainCards(mainCards);
            setMainCalled(true);
            
            // 明确设置是否是叫主玩家的状态
            const isCurrentPlayerMainCaller = mainCaller === socket.id;
            setIsMainCaller(isCurrentPlayerMainCaller);
            
            // 处理反主截止时间
            if (stealMainDeadline) {
                setStealMainDeadline(stealMainDeadline);
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
            
            // 反主后的状态处理
            setShowFixButton(false);  // 隐藏加固按钮
            setCanFixMain(false);     // 禁用加固功能
            setStealMainDeadline(null); // 清除反主/加固截止时间
            setStealMainTimeLeft(null); // 清除倒计时显示
            
            // 如果当前玩家是反主玩家，设置为已反主
            if (socket.id === mainCaller) {
                setHasCounteredMain(true);
            }
            
            // 更新状态，不可再反主
            setCanCounterMain(false);
            
            // 更新 preGameState
            setPreGameState(prev => ({
                ...prev,
                canStealMain: false
            }));
        });

        // 添加粘牌事件监听
        socket.on('playerStickCards', ({ playerId, mainCallerCards }) => {
            console.log('收到粘牌信息:', { playerId, mainCallerCards });
            // 设置叫主玩家的牌
            setMainCallerCards([
                { suit: 'JOKER', value: mainCallerCards.joker },
                { suit: mainCallerCards.pair.suit, value: mainCallerCards.pair.value },
                { suit: mainCallerCards.pair.suit, value: mainCallerCards.pair.value }
            ]);
        });

        // 添加交换完成的监听
        socket.on('cardsExchanged', ({ mainPlayer, stickPlayer }) => {
            console.log('Cards exchanged:', { mainPlayer, stickPlayer });
            // 清除所有相关状态
            setSelectedCards([]);
            setHasStickCards(false);
            setCanStickCards(false);
            setIsStickPhase(false);
            setStickMainTimeLeft(null);
            setStickMainDeadline(null);
            setMainCallerCards(null);
            // 清除反主相关状态
            setShowCounterButton(false);
            setCanCounterMain(false);
            setStealMainTimeLeft(null);
            setStealMainDeadline(null);
            setCounterJoker(null);
            setCounterPair(null);
        });

        // 添加交换错误的监听
        socket.on('exchangeError', ({ message }) => {
            console.log('Exchange error:', message);
            // 这里可以添加错误提示
        });

        // 修改接收底牌的监听器
        socket.on('receiveBottomCards', ({ bottomCards }) => {
            console.log('客户端收到的底牌数据:', bottomCards);
            console.log('底牌数量:', bottomCards ? bottomCards.length : 0);
            setBottomCards(bottomCards || []);
            setIsBottomDealer(true);
            
            // 记录底牌的标识，用于高亮显示
            const bottomCardIds = (bottomCards || []).map(card => `${card.suit}-${card.value}`);
            setCardsFromBottom(bottomCardIds);
            
            // 不再在这里更新手牌，由服务器通过 updatePlayerCards 事件更新
        });

        // 监听抠底错误
        socket.on('bottomDealError', ({ message }) => {
            // 这里可以添加错误提示
            console.error(message);
        });

        // 监听更新玩家手牌，恢复排序
        socket.on('updatePlayerCards', (cards) => {
            console.log('Received updated player cards:', cards);
            console.log('Cards type:', typeof cards);
            console.log('Is array:', Array.isArray(cards));
            
            if (!Array.isArray(cards)) {
                console.error('接收到的牌不是数组');
                return;
            }
            
            // 更新底牌标识列表
            const bottomCardIds = cards
                .filter(card => card.isFromBottom)
                .map(card => `${card.suit}-${card.value}`);
            
            if (bottomCardIds.length > 0) {
                console.log('底牌数量:', bottomCardIds.length);
                console.log('底牌标识:', bottomCardIds);
                setCardsFromBottom(bottomCardIds);
            }
            
            // 排序玩家手牌
            setPlayerCards(sortCards(cards));
        });

        // 监听游戏阶段变化
        socket.on('gamePhaseChanged', (data) => {
            if (data.phase === 'playing') {
                setGamePhase('playing');
                
                // 如果是抠底玩家，设置为当前出牌玩家
                if (data.currentPlayer === socket.id) {
                    setIsMyTurn(true);
                }
                
                setCurrentPlayer(data.currentPlayer);
            }
        });
        
        // 监听轮到谁出牌
        socket.on('playerTurn', (data) => {
            console.log('Received playerTurn event:', data);
            setCurrentPlayer(data.player);
            const isCurrentPlayerTurn = data.player === socket.id;
            console.log('Is current player turn:', isCurrentPlayerTurn, 'socket.id:', socket.id);
            setIsMyTurn(isCurrentPlayerTurn);
        });
        
        // 监听其他玩家出牌
        socket.on('cardPlayed', (data) => {
            console.log(`玩家 ${data.player} 出了 ${data.cards.length} 张牌`);
            // TODO: 在界面上显示其他玩家出的牌
        });
        
        // 监听轮次结束
        socket.on('roundEnd', (data) => {
            console.log(`本轮结束，玩家 ${data.winner} 获胜`);
            // TODO: 显示本轮结果
            
            // 如果下一个出牌的是自己
            if (data.nextPlayer === socket.id) {
                setIsMyTurn(true);
            }
        });
        
        // 监听出牌错误
        socket.on('playError', (data) => {
            console.error(data.message);
            // TODO: 显示错误信息
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
            socket.off('playerStickCards');
            socket.off('cardsExchanged');
            socket.off('exchangeError');
            socket.off('updatePlayerCards');
            socket.off('receiveBottomCards');
            socket.off('bottomDealError');
            socket.off('gamePhaseChanged');
            socket.off('playerTurn');
            socket.off('cardPlayed');
            socket.off('roundEnd');
            socket.off('playError');
        };
    }, [sortCards]); // 只依赖sortCards，因为它是稳定的callback函数

    // 检查是否可以加固或反主
    useEffect(() => {
        if (mainCalled && !hasCounteredMain) {  // 添加 !hasCounteredMain 条件
            if (mainCaller === socket.id || isMainCaller) {
                console.log('我是叫主玩家，检查是否可以加固，使用的王:', mainCards?.joker);
                checkCanFixMain(mainCards?.joker);
                setShowFixButton(true);
            } else {
                console.log('我是其他玩家，检查是否可以反主');
                checkCanCounterMain();
                setSelectedJoker(null);
                setShowCounterButton(true);
            }
        }
    }, [mainCalled, mainCaller, mainCards, isMainCaller, checkCanFixMain, checkCanCounterMain, playerCards, hasCounteredMain]);

    // 叫主倒计时
    useEffect(() => {
        if (callMainDeadline) {
            const intervalId = setInterval(() => {
                const now = Date.now();
                const timeLeft = Math.max(0, Math.floor((callMainDeadline - now) / 1000));
                setCallMainTimeLeft(timeLeft);
                
                if (timeLeft <= 0) {
                    clearInterval(intervalId);
                }
            }, 1000);
            
            return () => clearInterval(intervalId);
        }
    }, [callMainDeadline]);

    // 加固/反主倒计时
    useEffect(() => {
        if (stealMainDeadline && !hasCounteredMain) {  // 添加 !hasCounteredMain 条件
            const intervalId = setInterval(() => {
                const now = Date.now();
                const timeLeft = Math.max(0, Math.floor((stealMainDeadline - now) / 1000));
                setStealMainTimeLeft(timeLeft);
                
                if (timeLeft <= 0) {
                    clearInterval(intervalId);
                }
            }, 1000);
            
            return () => clearInterval(intervalId);
        }
    }, [stealMainDeadline, hasCounteredMain]);

    // 粘主倒计时
    useEffect(() => {
        if (stickMainDeadline && !hasStickCards) {  // 添加 !hasStickCards 条件
            const intervalId = setInterval(() => {
                const now = Date.now();
                const timeLeft = Math.max(0, Math.floor((stickMainDeadline - now) / 1000));
                setStickMainTimeLeft(timeLeft);
                
                if (timeLeft <= 0) {
                    clearInterval(intervalId);
                    setCanStickCards(false);
                    setStickMainTimeLeft(null);  // 清除倒计时显示
                }
            }, 1000);
            
            return () => {
                clearInterval(intervalId);
                if (hasStickCards) {
                    setStickMainTimeLeft(null);  // 当确认粘主后清除倒计时
                }
            };
        }
    }, [stickMainDeadline, hasStickCards]);

    // 抠底倒计时
    useEffect(() => {
        if (bottomDealDeadline) {
            const intervalId = setInterval(() => {
                const now = Date.now();
                const timeLeft = Math.max(0, Math.floor((bottomDealDeadline - now) / 1000));
                setBottomDealTimeLeft(timeLeft);
                
                if (timeLeft <= 0) {
                    clearInterval(intervalId);
                }
            }, 1000);
            
            return () => clearInterval(intervalId);
        }
    }, [bottomDealDeadline]);

    // 添加处理抠底的函数
    const handleConfirmBottomDeal = () => {
        if (selectedBottomCards.length === 4) {
            socket.emit('confirmBottomDeal', {
                roomId: localStorage.getItem('roomId'),
                putCards: selectedBottomCards
            });
            
            // 清理相关状态
            setSelectedBottomCards([]);
            setIsBottomDealer(false);
            setBottomDealTimeLeft(null);
            setCardsFromBottom([]);  // 清除底牌高亮
        }
    };

    // 修改底牌选择函数
    const handleBottomCardSelect = (card) => {
        if (!isBottomDealer) return;

        // 使用索引来找到完全相同的卡牌对象
        const cardIndex = playerCards.findIndex(c => c === card);
        const isSelected = selectedBottomCards.some(c => {
            const selectedIndex = playerCards.findIndex(pc => pc === c);
            return selectedIndex === cardIndex;
        });

        if (isSelected) {
            // 取消选中 - 使用索引来确保只取消特定的那张牌
            setSelectedBottomCards(prev => 
                prev.filter(c => {
                    const selectedIndex = playerCards.findIndex(pc => pc === c);
                    return selectedIndex !== cardIndex;
                })
            );
        } else if (selectedBottomCards.length < 4) {
            setSelectedBottomCards(prev => [...prev, card]);
        }
    };

    // 修改卡牌点击或悬浮的处理函数
    const handleCardInteraction = (card) => {
        if (card.isFromBottom) {
            setInteractedBottomCards(prev => {
                const newSet = new Set(prev);
                // 使用索引确保每张牌的唯一性
                const cardIndex = playerCards.findIndex(c => c === card);
                newSet.add(`${card.suit}-${card.value}-${cardIndex}`);
                return newSet;
            });
        }
    };

    // 修改 handlePlayCards 函数
    const handlePlayCards = () => {
        if (selectedCards.length > 0 && isMyTurn) {
            // 发送出牌事件到服务器
            socket.emit('playCards', {
                roomId: localStorage.getItem('roomId'),
                cards: selectedCards
            });
            
            // 清理选中状态
            setSelectedCards([]);
            setIsMyTurn(false);
        }
    };

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
                        <HStack>
                            <Button
                                colorScheme="blue"
                                onClick={handleCallMain}
                                isDisabled={!canCallMain || !selectedJoker || !selectedPair}
                            >
                                叫主
                            </Button>
                            {callMainTimeLeft !== null && (
                                <Text ml={2} color={callMainTimeLeft <= 3 ? "red.500" : "gray.500"}>
                                    {callMainTimeLeft}秒
                                </Text>
                            )}
                        </HStack>
                    </HStack>
                )}

                {/* 已叫主状态下 - 其他玩家的反主界面 */}
                {mainCalled && 
                 mainCaller !== socket.id && 
                 !hasCounteredMain && 
                 showCounterButton && 
                 !isStickPhase && 
                 gamePhase === 'pregame' && (  // 添加游戏阶段的判断
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

                        {/* 反主按钮 */}
                        <HStack>
                            <Button
                                colorScheme={hasCounteredMain ? "gray" : "red"}
                                onClick={handleCounterMain}
                                isDisabled={hasCounteredMain || !preGameState.canStealMain || !canCounterMain || !counterJoker || !counterPair}
                            >
                                {hasCounteredMain ? "已反主" : "反主"}
                            </Button>
                            {stealMainTimeLeft !== null && !hasCounteredMain && (
                                <Text ml={2} color={stealMainTimeLeft <= 3 ? "red.500" : "gray.500"}>
                                    {stealMainTimeLeft}秒
                                </Text>
                            )}
                        </HStack>
                    </HStack>
                )}

                {/* 已反主后的状态显示 */}
                {hasCounteredMain && !isStickPhase && (
                    <Button
                        colorScheme="gray"
                        isDisabled={true}
                    >
                        已反主
                    </Button>
                )}

                {/* 已叫主状态下 - 叫主玩家的加固按钮 */}
                {mainCalled && (mainCaller === socket.id || isMainCaller) && !hasCounteredMain && !isStickPhase && (
                    <HStack>
                        <Button
                            colorScheme={isMainFixed ? "gray" : "green"}
                            onClick={handleFixMain}
                            isDisabled={isMainFixed || !preGameState.canStealMain || !canFixMain}
                        >
                            {isMainFixed ? "已加固" : "加固"}
                        </Button>
                        {stealMainTimeLeft !== null && !isMainFixed && (
                            <Text ml={2} color={stealMainTimeLeft <= 3 ? "red.500" : "gray.500"}>
                                {stealMainTimeLeft}秒
                            </Text>
                        )}
                    </HStack>
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
                    {playerCards.map((card, index) => {
                        const isSelected = 
                            (gamePhase === 'bottomDeal' && isBottomDealer)
                                ? selectedBottomCards.some(c => {
                                    const selectedIndex = playerCards.findIndex(pc => pc === c);
                                    const currentIndex = playerCards.findIndex(pc => pc === card);
                                    return selectedIndex === currentIndex;
                                  })
                                : selectedCards.some(c => {
                                    const selectedIndex = playerCards.findIndex(pc => pc === c);
                                    const currentIndex = playerCards.findIndex(pc => pc === card);
                                    return selectedIndex === currentIndex;
                                  });
                        
                        const canSelect = 
                            (gamePhase === 'bottomDeal' && isBottomDealer)
                                ? selectedBottomCards.length < 4
                                : cardSelectionValidator?.(card, selectedCards);
                        
                        // 修改底牌检测逻辑
                        const isFromBottom = card.isFromBottom && 
                            cardsFromBottom.includes(`${card.suit}-${card.value}`);
                        const hasInteracted = interactedBottomCards.has(`${card.suit}-${card.value}-${index}`); // 添加索引确保唯一性
                        
                        return (
                            <div 
                                key={`${card.suit}-${card.value}-${index}`} 
                                className={`card-container ${isSelected ? 'selected' : ''} 
                                          ${!canSelect ? 'disabled' : ''}`}
                                onClick={() => {
                                    handleCardSelect(card);
                                    handleCardInteraction(card);
                                }}
                                onMouseEnter={() => handleCardInteraction(card)}
                            >
                                <Card 
                                    suit={card.suit}
                                    value={card.value}
                                    className={`player-card ${isFromBottom && !hasInteracted ? 'from-bottom' : ''}`}
                                />
                            </div>
                        );
                    })}
                </div>
            </Center>

            {/* 粘牌按钮 */}
            {isStickPhase && 
             preGameState.canStickMain && 
             mainCaller !== socket.id && 
             !hasStickCards && 
             gamePhase === 'stickPhase' && (  // 添加这个条件
                <HStack position="absolute" top="60%" left="50%" transform="translate(-50%, -50%)">
                    <Button
                        colorScheme="blue"
                        onClick={handleStickCards}
                        isDisabled={!canStickCards}
                    >
                        粘主
                    </Button>
                    {stickMainTimeLeft !== null && !hasStickCards && (
                        <Text ml={2} color={stickMainTimeLeft <= 3 ? "red.500" : "gray.500"}>
                            {stickMainTimeLeft}秒
                        </Text>
                    )}
                </HStack>
            )}

            {/* 显示叫主玩家的牌和选择要交换的牌 */}
            {isStickPhase && hasStickCards && (
                <Box 
                    position="absolute" 
                    top="50%" 
                    left="50%" 
                    transform="translate(-50%, -50%)"
                    bg="white"
                    p={4}
                    borderRadius="md"
                    boxShadow="lg"
                    zIndex={10}
                >
                    {/* 显示叫主玩家的牌 */}
                    {mainCallerCards && (
                        <Box mb={4}>
                            <Text fontWeight="bold" mb={2}>叫主玩家的牌：</Text>
                            <HStack spacing={2}>
                                {mainCallerCards.map((card, index) => (
                                    <Card 
                                        key={index}
                                        suit={card.suit}
                                        value={card.value}
                                    />
                                ))}
                            </HStack>
                        </Box>
                    )}

                    {/* 选择要交换的牌 */}
                    <Box>
                        <Text fontWeight="bold" mb={2}>选择要交换的牌：</Text>
                        <VStack align="start" spacing={2} mb={4}>
                            <HStack>
                                <Text>1. 先选择一张<strong>常主</strong>或<strong>固定常主</strong>(2/3/5)</Text>
                                {selectedCards.length > 0 && (
                                    <Text color="green.500" ml={2}>✓</Text>
                                )}
                            </HStack>
                            <HStack>
                                <Text>2. 再选择两张<strong>主花色</strong>的牌</Text>
                                {selectedCards.length === 3 && (
                                    <Text color="green.500" ml={2}>✓</Text>
                                )}
                            </HStack>
                        </VStack>
                        <Button
                            colorScheme="green"
                            onClick={handleConfirmStickCards}
                            isDisabled={selectedCards.length !== 3}
                            width="100%"
                        >
                            确认交换
                        </Button>
                    </Box>
                </Box>
            )}

            {/* 抠底界面 */}
            {gamePhase === 'bottomDeal' && isBottomDealer && (
                <Box 
                    position="absolute" 
                    top="50%" 
                    left="50%" 
                    transform="translate(-50%, -50%)"
                    bg="white"
                    p={4}
                    borderRadius="md"
                    boxShadow="lg"
                    zIndex={10}
                >
                    {/* 显示原来的底牌 */}
                    {bottomCards && bottomCards.length > 0 && (
                        <Box mb={4}>
                            <Text fontWeight="bold" mb={2}>原底牌：</Text>
                            <HStack spacing={2}>
                                {console.log('渲染的底牌数据:', bottomCards)}
                                {console.log('底牌数量:', bottomCards.length)}
                                {(bottomCards || []).map((card, index) => (
                                    <Card 
                                        key={index}
                                        suit={card.suit}
                                        value={card.value}
                                    />
                                ))}
                            </HStack>
                        </Box>
                    )}

                    {/* 选择要放入底牌的牌 */}
                    <Box>
                        <Text fontWeight="bold" mb={2}>请选择4张牌放入底牌：</Text>
                        <VStack align="start" spacing={2} mb={4}>
                            <HStack>
                                <Text>已选择 {selectedBottomCards.length}/4 张牌</Text>
                                {selectedBottomCards.length === 4 && (
                                    <Text color="green.500" ml={2}>✓</Text>
                                )}
                            </HStack>
                        </VStack>
                        <Button
                            colorScheme="green"
                            onClick={handleConfirmBottomDeal}
                            isDisabled={selectedBottomCards.length !== 4}
                            width="100%"
                        >
                            确认放底
                        </Button>
                        {bottomDealTimeLeft !== null && (
                            <Text mt={2} textAlign="center" color={bottomDealTimeLeft <= 5 ? "red.500" : "gray.500"}>
                                {bottomDealTimeLeft}秒
                            </Text>
                        )}
                    </Box>
                </Box>
            )}

            {/* 在玩家手牌区域下方添加 playing 阶段的 UI 组件 */}
            {gamePhase === 'playing' && (
                <VStack position="absolute" top="60%" left="50%" transform="translate(-50%, -50%)" spacing={4}>
                    {isMyTurn ? (
                        <Text fontSize="xl" fontWeight="bold" color="green.500">
                            轮到你出牌了!
                        </Text>
                    ) : (
                        <Text fontSize="xl" fontWeight="bold">
                            等待其他玩家出牌...
                        </Text>
                    )}
                    <Button
                        colorScheme="blue"
                        onClick={handlePlayCards}
                        isDisabled={selectedCards.length === 0 || !isMyTurn}
                    >
                        出牌
                    </Button>
                </VStack>
            )}
        </Box>
    );
}

export default GameLayout;