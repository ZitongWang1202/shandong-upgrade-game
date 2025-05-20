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
    VStack,
    Spinner
} from '@chakra-ui/react';
import Card from './Card';
import GameInfo from './GameInfo';
import PlayerInfoArea from './PlayerInfoArea';
import PlayerHandDisplay from './PlayerHandDisplay';
import ActionPanel from './ActionPanel';
import socket from '../../utils/socket';
import '../../cards.css';
import {
    isMainCard,
    isValidCardPattern,
    isValidFollow,
    sortCards,
    isConsecutive
} from '../../utils/cardLogic.js';

function GameLayout() {
    const [playerCards, setPlayerCards] = useState([]);
    const [gamePhase, setGamePhase] = useState('pregame');
    const [preGameState, setPreGameState] = useState({ 
        commonMain: '2',
        isDealing: true,
        dealingProgress: 0,
        canCallMain: false,
        callMainDeadline: null,
        callMainTimeLeft: null,
        mainCalled: false,
        mainSuit: null,
        mainCaller: null,
        mainCards: null,
        isMainCaller: false,
        canStealMain: false,
        stealMainDeadline: null,
        stealMainTimeLeft: null,
        isMainFixed: false,
        hasCounteredMain: false,
        canFixMain: false,
        canCounterMain: false,
        showFixButton: false,
        showCounterButton: false,
        counterJoker: null,
        counterPair: null,
        canStickMain: false,
        stickMainDeadline: null,
        stickMainTimeLeft: null,
        isStickPhase: false,
        hasStickCards: false,
        mainCallerCardsForSticking: null,
        selectedCardsForSticking: { commonMain: null, suitCards: [] },
        isBottomDealer: false,
        bottomCards: [],
        selectedBottomCards: [],
        bottomDealDeadline: null,
        bottomDealTimeLeft: null,
        cardsFromBottom: [],
        interactedBottomCards: new Set()
    });

    const [selectedJoker, setSelectedJoker] = useState(null);
    const [selectedPair, setSelectedPair] = useState(null);

    const [selectedCards, setSelectedCards] = useState([]);
    const [maxSelectableCards, setMaxSelectableCards] = useState(0);
    const [cardSelectionValidator, setCardSelectionValidator] = useState(null);

    const [isMyTurn, setIsMyTurn] = useState(false);
    const [currentPlayer, setCurrentPlayer] = useState(null);
    const [isFirstPlayerInRound, setIsFirstPlayerInRound] = useState(false);
    const [leadingPlay, setLeadingPlay] = useState(null);

    const [playersInfo, setPlayersInfo] = useState([]);
    const [playedCardsInfo, setPlayedCardsInfo] = useState({});
    const [isLoadingPlayers, setIsLoadingPlayers] = useState(true);

    const handleConfirmBottomDeal = () => {
        if (preGameState.selectedBottomCards.length === 4) {
            socket.emit('confirmBottomDeal', {
                roomId: localStorage.getItem('roomId'),
                putCards: preGameState.selectedBottomCards
            });
            setPreGameState(prev => ({
                ...prev,
                selectedBottomCards: [],
                isBottomDealer: false,
                bottomDealTimeLeft: null,
                cardsFromBottom: []
            }));
        }
    };

    const handleBottomCardSelect = (card) => {
        if (!preGameState.isBottomDealer) return;
        const cardIndex = playerCards.findIndex(c => c === card);
        const isSelected = preGameState.selectedBottomCards.some(c => {
            const selectedIndex = playerCards.findIndex(pc => pc === c);
            return selectedIndex === cardIndex;
        });
        if (isSelected) {
            setPreGameState(prev => ({
                ...prev,
                selectedBottomCards: prev.selectedBottomCards.filter(c => {
                    const selectedIndex = playerCards.findIndex(pc => pc === c);
                    return selectedIndex !== cardIndex;
                })
            }));
        } else if (preGameState.selectedBottomCards.length < 4) {
            setPreGameState(prev => ({ ...prev, selectedBottomCards: [...prev.selectedBottomCards, card] }));
        }
    };

    const handleCardInteraction = (card) => {
        if (card.isFromBottom) {
            setPreGameState(prev => {
                const newSet = new Set(prev.interactedBottomCards);
                const cardIndex = playerCards.findIndex(c => c === card);
                newSet.add(`${card.suit}-${card.value}-${cardIndex}`);
                return { ...prev, interactedBottomCards: newSet };
            });
        }
    };

    const handlePlayCards = () => {
        if (selectedCards.length > 0 && isMyTurn) {
            if (isFirstPlayerInRound) {
                if (!isValidCardPattern(selectedCards, preGameState.mainSuit, preGameState.commonMain)) {
                    alert("出牌失败：领出牌不构成有效牌型"); 
                    return; 
                }
            } else {
                if (!isValidFollow(selectedCards, playerCards, leadingPlay, preGameState.mainSuit, preGameState.commonMain)) {
                    alert("出牌失败：跟牌不符合规则");
                    return;
                }
            }
            socket.emit('playCards', { roomId: localStorage.getItem('roomId'), cards: selectedCards });
            setSelectedCards([]);
            setIsMyTurn(false);
        }
    };

    const validators = useMemo(() => ({
        stickPhase: (card, currentSelected) => {
            if (currentSelected.length >= 3) return false;
            if (currentSelected.length === 0) {
                return card.value === preGameState.commonMain || ['2', '3', '5'].includes(card.value);
            }
            return card.suit === preGameState.mainSuit && currentSelected.length < 3;
        },
        gaming: (card, currentSelected) => {
            if (!isMyTurn) return false;
            if (isFirstPlayerInRound) {
                if (currentSelected.length === 0) return true;
                const potentialSelection = [...currentSelected, card];
                return isValidCardPattern(potentialSelection, preGameState.mainSuit, preGameState.commonMain);
                } else {
                if (!leadingPlay || !leadingPlay.cards) return true;
                return currentSelected.length < leadingPlay.cards.length;
            }
        }
    }), [isMyTurn, isFirstPlayerInRound, preGameState.commonMain, preGameState.mainSuit, leadingPlay]);

    const hasJoker = useCallback((value) => {
        return playerCards.some(card => card.suit === 'JOKER' && card.value === value);
    }, [playerCards]);

    const hasJokerPair = useCallback((value) => {
        return playerCards.filter(card => card.suit === 'JOKER' && card.value === value).length === 2;
    }, [playerCards]);

    const getPairs = useCallback((suit) => {
        const pairs = {};
        playerCards.forEach(card => {
            if (card.suit === suit) {
                pairs[card.value] = (pairs[card.value] || 0) + 1;
            }
        });
        return Object.entries(pairs).filter(([_, count]) => count >= 2).map(([value]) => value);
    }, [playerCards]);

    const handleJokerSelect = (value) => {
        setSelectedJoker(value);
        setSelectedPair(null);
    };

    const handlePairSelect = (suit, value) => {
        setSelectedPair({ suit, value });
    };

    const handleCallMain = () => {
        if (preGameState.canCallMain) {
            socket.emit('callMain', { roomId: localStorage.getItem('roomId'), mainSuit: selectedPair?.suit, mainCards: { joker: selectedJoker, pair: selectedPair } });
        }
    };

    const checkCanFixMain = useCallback((usedJoker) => {
        if (!usedJoker) {
            setPreGameState(prev => ({ ...prev, canFixMain: false }));
            return;
        }
        const jokerCount = playerCards.filter(card => card.suit === 'JOKER' && card.value === usedJoker).length;
        setPreGameState(prev => ({ ...prev, canFixMain: jokerCount >= 2 && prev.canStealMain && !prev.isMainFixed }));
    }, [playerCards]);

    const checkCanCounterMain = useCallback(() => {
        const hasBigJokerPairValue = hasJokerPair('BIG');
        const hasSmallJokerPairValue = hasJokerPair('SMALL');
        const hasAnyPair = Object.values(getPairs('HEARTS')).length > 0 || Object.values(getPairs('SPADES')).length > 0 || Object.values(getPairs('DIAMONDS')).length > 0 || Object.values(getPairs('CLUBS')).length > 0;
        setPreGameState(prev => ({ ...prev, canCounterMain: (hasBigJokerPairValue || hasSmallJokerPairValue) && hasAnyPair }));
    }, [hasJokerPair, getPairs]); 

    const handleCounterMain = () => {
        if (preGameState.canCounterMain && preGameState.counterJoker && preGameState.counterPair) {
            socket.emit('counterMain', { roomId: localStorage.getItem('roomId'), mainSuit: preGameState.counterPair.suit, mainCards: { joker: preGameState.counterJoker, pair: preGameState.counterPair } });
            setPreGameState(prev => ({ ...prev, hasCounteredMain: true }));
        }
    };

    const handleFixMain = () => {
        if (preGameState.canFixMain && !preGameState.isMainFixed) {
            socket.emit('fixMain', { roomId: localStorage.getItem('roomId') });
        }
    };

    const checkCanStickCards = useCallback(() => {
        if (preGameState.mainCaller === socket.id || preGameState.hasStickCards) {
            setPreGameState(prev => ({ ...prev, canStickMain: false }));
            return;
        }
        const hasAnyJokerValue = playerCards.some(card => card.suit === 'JOKER');
        if (!hasAnyJokerValue) {
            setPreGameState(prev => ({ ...prev, canStickMain: false }));
            return;
        }
        const suitPairs = {};
        playerCards.forEach(card => {
            if (card.suit !== 'JOKER') {
                if (!suitPairs[card.suit]) suitPairs[card.suit] = {};
                suitPairs[card.suit][card.value] = (suitPairs[card.suit][card.value] || 0) + 1;
            }
        });
        const hasAnyConsecutivePair = Object.values(suitPairs).some(suitCards => {
            const values = Object.entries(suitCards).filter(([_, count]) => count >= 2).map(([value]) => value);
            for (let i = 0; i < values.length - 1; i++) {
                if (isConsecutive(values[i], values[i + 1])) return true;
            }
            return false;
        });
        setPreGameState(prev => ({ ...prev, canStickMain: hasAnyJokerValue && hasAnyConsecutivePair }));
    }, [playerCards, preGameState.mainCaller, preGameState.hasStickCards]);

    const handleStickCards = () => {
        if (preGameState.canStickMain) {
            socket.emit('stickCards', { roomId: localStorage.getItem('roomId') });
        }
    };

    const handleSelectStickCards = (card) => {
        if (!preGameState.isStickPhase || preGameState.hasStickCards) return;
        if (preGameState.selectedCardsForSticking.commonMain && preGameState.selectedCardsForSticking.commonMain.suit === card.suit && preGameState.selectedCardsForSticking.commonMain.value === card.value) {
            setPreGameState(prev => ({ ...prev, selectedCardsForSticking: { ...prev.selectedCardsForSticking, commonMain: null } }));
            return;
        }
        if (preGameState.selectedCardsForSticking.suitCards.some(c => c.suit === card.suit && c.value === card.value)) {
            setPreGameState(prev => ({ ...prev, selectedCardsForSticking: { ...prev.selectedCardsForSticking, suitCards: prev.selectedCardsForSticking.suitCards.filter(c => !(c.suit === card.suit && c.value === card.value)) } }));
            return;
        }
        if (card.value === preGameState.commonMain || ['2', '3', '5'].includes(card.value)) {
            setPreGameState(prev => ({ ...prev, selectedCardsForSticking: { ...prev.selectedCardsForSticking, commonMain: card } }));
        } else if (card.suit === preGameState.mainSuit && preGameState.selectedCardsForSticking.suitCards.length < 2) {
            setPreGameState(prev => ({ ...prev, selectedCardsForSticking: { ...prev.selectedCardsForSticking, suitCards: [...prev.selectedCardsForSticking.suitCards, card] } }));
        }
    };

    const handleCardSelect = (card) => {
        if (gamePhase === 'bottomDeal' && preGameState.isBottomDealer) {
            handleBottomCardSelect(card);
            return;
        }
        if (gamePhase !== 'playing') return;
        if (!cardSelectionValidator) return;
        const cardIndex = playerCards.findIndex(c => c === card);
        const isCardSelected = selectedCards.some(c => playerCards.findIndex(pc => pc === c) === cardIndex);
        if (isCardSelected) {
            setSelectedCards(prev => prev.filter(c => playerCards.findIndex(pc => pc === c) !== cardIndex));
        } else {
            if (cardSelectionValidator(card, selectedCards)) {
                setSelectedCards(prev => [...prev, card]);
            }
        }
    };

    useEffect(() => {
        const gamingValidator = validators.gaming;
        if (gamePhase === 'playing' || gamePhase === 'gaming') {
            setMaxSelectableCards(100); 
            setCardSelectionValidator(() => gamingValidator);
        } else { 
            setMaxSelectableCards(0);
            setCardSelectionValidator(null);
        }
    }, [gamePhase, validators]);

    const handleConfirmStickCards = () => {
        const { commonMain, suitCards } = preGameState.selectedCardsForSticking;
        if (commonMain && suitCards.length === 2) {
            socket.emit('confirmStickCards', { roomId: localStorage.getItem('roomId'), cards: { commonMain, suitCards } });
            setPreGameState(prev => ({ ...prev, stickMainTimeLeft: null, canStickMain: false }));
        }
    };

    useEffect(() => {
        const currentRoomId = localStorage.getItem('roomId');
        if (!socket.id || !currentRoomId) {
            if (!socket.id) console.log('[GameLayout Consolidated Effect] Waiting for socket.id.');
            if (!currentRoomId) console.error('[GameLayout Consolidated Effect] No roomId found.');
            return;
        }

        const effectHandleGameStart = () => {
            setGamePhase('pregame');
            setIsLoadingPlayers(true);
            setPlayersInfo([]);
            setPreGameState(prev => ({ ...prev, commonMain: '2', isDealing: true, dealingProgress: 0, mainCalled: false, mainSuit: null, mainCaller: null, mainCards: null, isMainFixed: false, hasCounteredMain: false, canCallMain: false, bottomCards: [], selectedBottomCards: [], cardsFromBottom: [], interactedBottomCards: new Set() }));
            setPlayerCards([]);
            setSelectedCards([]);
            setPlayedCardsInfo({});
            setLeadingPlay(null);
            setCurrentPlayer(null);
            setIsMyTurn(false);
            setIsFirstPlayerInRound(false);
            setMaxSelectableCards(0);
            setCardSelectionValidator(null);
        };
        const effectHandleReceiveCard = ({ card }) => {
            setPlayerCards(prevCards => sortCards([...prevCards, card], preGameState.mainSuit, preGameState.commonMain));
        };
        const effectHandleDealingProgress = ({ currentRound, totalRounds }) => {
            const progress = (currentRound / totalRounds) * 100;
            setPreGameState(prev => ({ ...prev, dealingProgress: progress }));
            if (currentRound === totalRounds) {
                setPreGameState(prev => ({ ...prev, isDealing: false, dealingProgress: 100 }));
            }
        };
        const effectHandleUpdateGameState = (newServerState) => {
            if (newServerState.phase) setGamePhase(newServerState.phase);
            if (newServerState.preGameState) {
                setPreGameState(prev => {
                    const updated = { ...prev, ...newServerState.preGameState };
                    if (newServerState.preGameState.interactedBottomCards && Array.isArray(newServerState.preGameState.interactedBottomCards)) {
                        updated.interactedBottomCards = new Set(newServerState.preGameState.interactedBottomCards);
                    } else if (!newServerState.preGameState.interactedBottomCards) {
                        updated.interactedBottomCards = prev.interactedBottomCards instanceof Set ? prev.interactedBottomCards : new Set();
                    }
                    return updated;
                });
            }
        };
        const effectHandleMainCalled = ({ mainSuit, mainCaller, mainCards, stealMainDeadline }) => {
            setPreGameState(prev => ({ ...prev, mainSuit, mainCaller, mainCards, mainCalled: true, isMainCaller: mainCaller === socket.id, stealMainDeadline: stealMainDeadline || prev.stealMainDeadline, canStealMain: true, isMainFixed: false }));
        };
        const effectHandleMainFixed = () => {
            setPreGameState(prev => ({ ...prev, isMainFixed: true, canStealMain: false, stealMainDeadline: null, stealMainTimeLeft: null }));
        };
        const effectHandleMainCountered = ({ mainCaller, mainSuit, mainCards }) => {
            setPreGameState(prev => ({ ...prev, mainCaller, mainSuit, mainCards, hasCounteredMain: true, isMainCaller: mainCaller === socket.id, isMainFixed: false, canStealMain: false, stealMainDeadline: null, stealMainTimeLeft: null }));
        };
        const effectHandlePlayerStickCards = ({ mainCallerCards }) => {
            setPreGameState(prev => ({ ...prev, mainCallerCardsForSticking: mainCallerCards, isStickPhase: true }));
        };
        const effectHandleCardsExchanged = () => {
            setPreGameState(prev => ({ ...prev, hasStickCards: false, canStickMain: false, isStickPhase: false, stickMainTimeLeft: null, stickMainDeadline: null, mainCallerCardsForSticking: null, selectedCardsForSticking: { commonMain: null, suitCards: [] }, canStealMain: false, stealMainDeadline: null, stealMainTimeLeft: null, showCounterButton: false, counterJoker: null, counterPair: null }));
            setSelectedCards([]);
        };
        const effectHandleExchangeError = ({ message }) => { console.error('[GameLayout Consolidated Effect] Event: exchangeError', message); };
        const effectHandleUpdatePlayerCards = (cards) => {
            if (!Array.isArray(cards)) { console.error('Received player cards are not an array'); return; }
            const bottomCardIdsFromPlayerHand = cards.filter(card => card.isFromBottom).map(card => `${card.suit}-${card.value}`);
            if (bottomCardIdsFromPlayerHand.length > 0) {
                setPreGameState(prev => ({ ...prev, cardsFromBottom: bottomCardIdsFromPlayerHand }));
            }
            setPlayerCards(sortCards(cards, preGameState.mainSuit, preGameState.commonMain));
        };
        const effectHandleReceiveBottomCards = ({ bottomCards: rcvBottomCards, bottomDealDeadline: newDeadline }) => {
            const bottomIds = (rcvBottomCards || []).map(c => `${c.suit}-${c.value}`);
            setPreGameState(prev => ({ ...prev, bottomCards: rcvBottomCards || [], isBottomDealer: true, cardsFromBottom: bottomIds, bottomDealDeadline: newDeadline || prev.bottomDealDeadline }));
        };
        const effectHandleBottomDealError = ({ message }) => { console.error('[GameLayout Consolidated Effect] Event: bottomDealError', message); };
        const effectHandleGamePhaseChanged = (data) => {
            if (data.phase === 'playing') {
                setGamePhase('playing');
                if (data.currentPlayer === socket.id) setIsMyTurn(true);
                setCurrentPlayer(data.currentPlayer);
            }
        };
        const effectHandlePlayerTurn = (data) => {
            setCurrentPlayer(data.player);
            setIsMyTurn(data.player === socket.id);
            setIsFirstPlayerInRound(data.isFirstPlayer); 
            setLeadingPlay(data.leadingPlay || null);
            if (data.isFirstPlayer) setPlayedCardsInfo({});
            if (data.player !== socket.id) setSelectedCards([]);
        };
        const effectHandleCardPlayed = (data) => {
            setPlayedCardsInfo(prev => ({ ...prev, [data.player]: data.cards }));
        };
        const effectHandleRoundEnd = (data) => {
            if (data.nextPlayer === socket.id) {
                setIsMyTurn(true);
                setIsFirstPlayerInRound(true);
            } else {
                setIsFirstPlayerInRound(false);
            }
            setLeadingPlay(null);
        };
        const effectHandlePlayError = (data) => { console.error('[GameLayout Consolidated Effect] Event: playError', data.message); };
        const effectHandleRoomInfo = (room) => {
            if (!room || !room.players) { setIsLoadingPlayers(false); return; }
            const selfId = socket.id;
            const playerIndex = room.players.findIndex(p => p.id === selfId);
            let orderedPlayers = [];
            if (playerIndex !== -1 && room.players.length === 4) {
                orderedPlayers = [
                    { ...room.players[playerIndex], position: 'bottom' },
                    { ...room.players[(playerIndex + 1) % 4], position: 'right' },
                    { ...room.players[(playerIndex + 2) % 4], position: 'top' },
                    { ...room.players[(playerIndex + 3) % 4], position: 'left' },
                ];
            } else if (room.players.length > 0) { 
                orderedPlayers = room.players.map((p, i) => ({ ...p, position: p.id === selfId ? 'bottom' : ['right', 'top', 'left'][i % 3] }));
            }
            setPlayersInfo(orderedPlayers);
            setIsLoadingPlayers(false);
        };

        console.log('[GameLayout Consolidated Effect] Setting up ALL listeners and emitting gameLayoutReadyForData.');
        socket.on('gameStart', effectHandleGameStart);
        socket.on('receiveCard', effectHandleReceiveCard);
        socket.on('dealingProgress', effectHandleDealingProgress);
        socket.on('updateGameState', effectHandleUpdateGameState);
        socket.on('mainCalled', effectHandleMainCalled);
        socket.on('mainFixed', effectHandleMainFixed);
        socket.on('mainCountered', effectHandleMainCountered);
        socket.on('playerStickCards', effectHandlePlayerStickCards);
        socket.on('cardsExchanged', effectHandleCardsExchanged);
        socket.on('exchangeError', effectHandleExchangeError);
        socket.on('updatePlayerCards', effectHandleUpdatePlayerCards);
        socket.on('receiveBottomCards', effectHandleReceiveBottomCards);
        socket.on('bottomDealError', effectHandleBottomDealError);
        socket.on('gamePhaseChanged', effectHandleGamePhaseChanged);
        socket.on('playerTurn', effectHandlePlayerTurn);
        socket.on('cardPlayed', effectHandleCardPlayed);
        socket.on('roundEnd', effectHandleRoundEnd);
        socket.on('playError', effectHandlePlayError);
        socket.on('roomInfo', effectHandleRoomInfo);
        socket.emit('gameLayoutReadyForData', { roomId: currentRoomId });

        return () => {
            console.log('[GameLayout Consolidated Effect] Cleanup: Detaching ALL listeners.');
            socket.off('gameStart', effectHandleGameStart);
            socket.off('receiveCard', effectHandleReceiveCard);
            socket.off('dealingProgress', effectHandleDealingProgress);
            socket.off('updateGameState', effectHandleUpdateGameState);
            socket.off('mainCalled', effectHandleMainCalled);
            socket.off('mainFixed', effectHandleMainFixed);
            socket.off('mainCountered', effectHandleMainCountered);
            socket.off('playerStickCards', effectHandlePlayerStickCards);
            socket.off('cardsExchanged', effectHandleCardsExchanged);
            socket.off('exchangeError', effectHandleExchangeError);
            socket.off('updatePlayerCards', effectHandleUpdatePlayerCards);
            socket.off('receiveBottomCards', effectHandleReceiveBottomCards);
            socket.off('bottomDealError', effectHandleBottomDealError);
            socket.off('gamePhaseChanged', effectHandleGamePhaseChanged);
            socket.off('playerTurn', effectHandlePlayerTurn);
            socket.off('cardPlayed', effectHandleCardPlayed);
            socket.off('roundEnd', effectHandleRoundEnd);
            socket.off('playError', effectHandlePlayError);
            socket.off('roomInfo', effectHandleRoomInfo);
        };
    }, [socket.id, preGameState.mainSuit, preGameState.commonMain]);

    useEffect(() => {
        if (preGameState.callMainDeadline) {
            const intervalId = setInterval(() => {
                const timeLeft = Math.max(0, Math.floor((preGameState.callMainDeadline - Date.now()) / 1000));
                setPreGameState(prev => ({ ...prev, callMainTimeLeft: timeLeft }));
                if (timeLeft <= 0) clearInterval(intervalId);
            }, 1000);
            return () => clearInterval(intervalId);
        }
    }, [preGameState.callMainDeadline]);

    useEffect(() => {
        if (preGameState.stealMainDeadline && !preGameState.hasCounteredMain && !preGameState.isMainFixed) {
            const intervalId = setInterval(() => {
                const timeLeft = Math.max(0, Math.floor((preGameState.stealMainDeadline - Date.now()) / 1000));
                setPreGameState(prev => ({ ...prev, stealMainTimeLeft: timeLeft }));
                if (timeLeft <= 0) clearInterval(intervalId);
            }, 1000);
            return () => clearInterval(intervalId);
        }
    }, [preGameState.stealMainDeadline, preGameState.hasCounteredMain, preGameState.isMainFixed]);

    useEffect(() => {
        if (preGameState.stickMainDeadline && !preGameState.hasStickCards) {
            const intervalId = setInterval(() => {
                const timeLeft = Math.max(0, Math.floor((preGameState.stickMainDeadline - Date.now()) / 1000));
                setPreGameState(prev => ({ ...prev, stickMainTimeLeft: timeLeft }));
                if (timeLeft <= 0) {
                    clearInterval(intervalId);
                    setPreGameState(prev => ({ ...prev, canStickMain: false, stickMainTimeLeft: null }));
                }
            }, 1000);
            return () => clearInterval(intervalId);
        }
    }, [preGameState.stickMainDeadline, preGameState.hasStickCards]);

    useEffect(() => {
        if (preGameState.bottomDealDeadline) {
            const intervalId = setInterval(() => {
                const timeLeft = Math.max(0, Math.floor((preGameState.bottomDealDeadline - Date.now()) / 1000));
                setPreGameState(prev => ({ ...prev, bottomDealTimeLeft: timeLeft }));
                if (timeLeft <= 0) clearInterval(intervalId);
            }, 1000);
            return () => clearInterval(intervalId);
        }
    }, [preGameState.bottomDealDeadline]);

    useEffect(() => {
        const { mainCalled, hasCounteredMain, mainCaller, canStealMain, isMainFixed } = preGameState;
        const currentSocketId = socket.id;
        const shouldCheck = mainCalled && !hasCounteredMain && canStealMain && !isMainFixed;
        let newShowFixButton = false;
        let newShowCounterButton = false;
        if (shouldCheck) {
            if (mainCaller === currentSocketId) newShowFixButton = true;
            else newShowCounterButton = true;
        }
        if (newShowFixButton !== preGameState.showFixButton || newShowCounterButton !== preGameState.showCounterButton) {
            setPreGameState(prev => ({ ...prev, showFixButton: newShowFixButton, showCounterButton: newShowCounterButton }));
        }
    }, [preGameState.mainCalled, preGameState.hasCounteredMain, preGameState.mainCaller, preGameState.canStealMain, preGameState.isMainFixed, socket.id, preGameState.showFixButton, preGameState.showCounterButton]);

    useEffect(() => {
        if (gamePhase === 'playing') {
            setSelectedCards([]);
            setPreGameState(prev => ({ ...prev, selectedBottomCards: [] }));
        }
    }, [gamePhase]);

    const isPlayButtonDisabled = useMemo(() => {
        if (!isMyTurn || selectedCards.length === 0) return true;
        if (isFirstPlayerInRound) {
            return !isValidCardPattern(selectedCards, preGameState.mainSuit, preGameState.commonMain);
        } else {
            return !isValidFollow(selectedCards, playerCards, leadingPlay, preGameState.mainSuit, preGameState.commonMain);
        }
    }, [isMyTurn, selectedCards, isFirstPlayerInRound, leadingPlay, playerCards, preGameState.mainSuit, preGameState.commonMain]);

    if (isLoadingPlayers) {
    return (
            <Center h="100vh" bg="green.700">
                <Spinner size="xl" color="white" />
                <Text ml={4} color="white" fontSize="lg">正在加载玩家信息...</Text>
            </Center>
        );
    }

    return (
        <Box position="relative" h="100vh" bg="green.700" overflow="hidden">
            <GameInfo 
                mainSuit={preGameState.mainSuit}
                mainCaller={preGameState.mainCaller}
                mainCards={preGameState.mainCards}
                gamePhase={gamePhase}
                preGameState={preGameState}
                isMainFixed={preGameState.isMainFixed}
                hasCounteredMain={preGameState.hasCounteredMain}
            />
            
            <PlayerInfoArea 
                playersInfo={playersInfo}
                playedCardsInfo={playedCardsInfo}
                isLoadingPlayers={isLoadingPlayers}
                currentPlayer={currentPlayer}
                mainCaller={preGameState.mainCaller}
                currentUserId={socket.id}
            />

            {gamePhase === 'pregame' && preGameState.isDealing && (
                <Center position="absolute" top="50%" left="50%" transform="translate(-50%, -50%)">
                    <Box w="300px">
                        <Text mb={2} textAlign="center">发牌中... {Math.floor(preGameState.dealingProgress)}%</Text>
                        <Progress value={preGameState.dealingProgress} size="lg" colorScheme="blue" />
                    </Box>
                </Center>
            )}

            <Center position="absolute" top="60%" left="50%" transform="translate(-50%, -50%)" zIndex={15}>
                {!preGameState.mainCalled && preGameState.canCallMain && (
                    <HStack spacing={4}>
                        <HStack spacing={2}>
                            <Button colorScheme={selectedJoker === 'BIG' ? 'green' : 'gray'} onClick={() => handleJokerSelect('BIG')} isDisabled={!hasJoker('BIG')}><Text color="red">大王</Text></Button>
                            <Button colorScheme={selectedJoker === 'SMALL' ? 'green' : 'gray'} onClick={() => handleJokerSelect('SMALL')} isDisabled={!hasJoker('SMALL')}>小王</Button>
                        </HStack>
                        <HStack spacing={0}>
                            {['HEARTS', 'SPADES', 'DIAMONDS', 'CLUBS'].map((suit) => (
                                <Menu key={suit}>
                                    <MenuButton as={Button} colorScheme={selectedPair?.suit === suit ? 'green' : 'gray'} isDisabled={getPairs(suit).length === 0}>
                                        {suit === 'HEARTS' ? '♥️' : suit === 'SPADES' ? '♠️' : suit === 'DIAMONDS' ? '♦️' : '♣️'}
                                    </MenuButton>
                                    <MenuList>
                                        {getPairs(suit).map(value => (<MenuItem key={value} onClick={() => handlePairSelect(suit, value)}>{value}</MenuItem>))}
                                    </MenuList>
                                </Menu>
                            ))}
                        </HStack>
                        <HStack>
                            <Button colorScheme="blue" onClick={handleCallMain} isDisabled={!preGameState.canCallMain || !selectedJoker || !selectedPair}>叫主</Button>
                            {preGameState.callMainTimeLeft !== null && (<Text ml={2} color={preGameState.callMainTimeLeft <= 3 ? "red.500" : "gray.500"}>{preGameState.callMainTimeLeft}秒</Text>)}
                        </HStack>
                    </HStack>
                )}
                {preGameState.showCounterButton && (
                    <HStack spacing={4}>
                        {preGameState.canStealMain && !preGameState.hasCounteredMain && (
                            <>
                                <HStack spacing={2}>
                                    <Button colorScheme={preGameState.counterJoker === 'BIG' ? 'green' : 'gray'} onClick={() => setPreGameState(prev => ({ ...prev, counterJoker: 'BIG' }))} isDisabled={!hasJokerPair('BIG')}><Text color="red">大王(对)</Text></Button>
                                    <Button colorScheme={preGameState.counterJoker === 'SMALL' ? 'green' : 'gray'} onClick={() => setPreGameState(prev => ({ ...prev, counterJoker: 'SMALL' }))} isDisabled={!hasJokerPair('SMALL')}>小王(对)</Button>
                                </HStack>
                                <HStack spacing={0}>
                                    {['HEARTS', 'SPADES', 'DIAMONDS', 'CLUBS'].map((suit) => (
                                        <Menu key={suit}>
                                            <MenuButton as={Button} colorScheme={preGameState.counterPair?.suit === suit ? 'green' : 'gray'} isDisabled={getPairs(suit).length === 0}>
                                                {suit === 'HEARTS' ? '♥' : suit === 'SPADES' ? '♠' : suit === 'DIAMONDS' ? '♦' : '♣'}
                                            </MenuButton>
                                            <MenuList>
                                                {getPairs(suit).map(value => (<MenuItem key={value} onClick={() => setPreGameState(prev => ({ ...prev, counterPair: { suit, value } }))}>{value}</MenuItem>))}
                                            </MenuList>
                                        </Menu>
                                    ))}
                                </HStack>
                            </>
                        )}
                        <HStack>
                            <Button colorScheme={preGameState.hasCounteredMain ? "gray" : "red"} onClick={handleCounterMain} isDisabled={preGameState.hasCounteredMain || !preGameState.canStealMain || !preGameState.canCounterMain || !preGameState.counterJoker || !preGameState.counterPair}>
                                {preGameState.hasCounteredMain ? "已反主" : "反主"}
                            </Button>
                            {preGameState.stealMainTimeLeft !== null && !preGameState.hasCounteredMain && (<Text ml={2} color={preGameState.stealMainTimeLeft <= 3 ? "red.500" : "gray.500"}>{preGameState.stealMainTimeLeft}秒</Text>)}
                        </HStack>
                    </HStack>
                )}
                {preGameState.hasCounteredMain && !preGameState.isStickPhase && (<Button colorScheme="gray" isDisabled={true}>已反主</Button>)}
                {preGameState.showFixButton && (
                    <HStack>
                        <Button colorScheme={preGameState.isMainFixed ? "gray" : "green"} onClick={handleFixMain} isDisabled={preGameState.isMainFixed || !preGameState.canStealMain || !preGameState.canFixMain}>
                            {preGameState.isMainFixed ? "已加固" : "加固"}
                        </Button>
                        {preGameState.stealMainTimeLeft !== null && !preGameState.isMainFixed && (<Text ml={2} color={preGameState.stealMainTimeLeft <= 3 ? "red.500" : "gray.500"}>{preGameState.stealMainTimeLeft}秒</Text>)}
                    </HStack>
                )}
            </Center>
            
            <PlayerHandDisplay
                playerCards={sortCards(playerCards, preGameState.mainSuit, preGameState.commonMain)}
                selectedCards={selectedCards}
                onCardSelect={handleCardSelect} 
                onCardInteraction={handleCardInteraction} 
                gamePhase={gamePhase}
                preGameState={preGameState}
                cardSelectionValidator={validators.gaming}
                socketId={socket.id}
            />

            {preGameState.isStickPhase && preGameState.canStickMain && preGameState.mainCaller !== socket.id && !preGameState.hasStickCards && gamePhase === 'stickPhase' && (
                <HStack position="absolute" top="60%" left="50%" transform="translate(-50%, -50%)" zIndex={15}>
                    <Button colorScheme="blue" onClick={handleStickCards} isDisabled={!preGameState.canStickMain}>粘主</Button>
                    {preGameState.stickMainTimeLeft !== null && !preGameState.hasStickCards && (<Text ml={2} color={preGameState.stickMainTimeLeft <= 3 ? "red.500" : "gray.500"}>{preGameState.stickMainTimeLeft}秒</Text>)}
                </HStack>
            )}

            {preGameState.isStickPhase && preGameState.mainCaller === socket.id && !preGameState.hasStickCards && (
                <Box position="absolute" top="50%" left="50%" transform="translate(-50%, -50%)" bg="white" p={4} borderRadius="md" boxShadow="lg" zIndex={20}>
                    <Button colorScheme="green" onClick={handleConfirmStickCards} isDisabled={!preGameState.selectedCardsForSticking.commonMain || preGameState.selectedCardsForSticking.suitCards.length !== 2} width="100%">确认交换</Button>
                </Box>
            )}

            <ActionPanel 
                gamePhase={gamePhase}
                isMyTurn={isMyTurn}
                onPlayCards={handlePlayCards}
                isPlayButtonDisabled={isPlayButtonDisabled}
                preGameState={preGameState}
                onConfirmBottomDeal={handleConfirmBottomDeal}
                leadingPlay={leadingPlay}
                isFirstPlayerInRound={isFirstPlayerInRound}
                playersInfo={playersInfo}
                currentPlayer={currentPlayer}
                socketId={socket.id}
            />
        </Box>
    );
}

export default GameLayout;