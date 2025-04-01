import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@chakra-ui/react';
import io from 'socket.io-client';

const GameLayout = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [roomId, setRoomId] = useState('');
    const [gameState, setGameState] = useState({});
    const [players, setPlayers] = useState([]);
    const [dealingProgress, setDealingProgress] = useState(0);
    const [currentCard, setCurrentCard] = useState(null);

    const socket = io();

    useEffect(() => {
        // 获取保存的房间ID
        const savedRoomId = localStorage.getItem('roomId');
        if (savedRoomId && savedRoomId !== roomId) {
            setRoomId(savedRoomId);
        }

        // 监听游戏开始
        socket.on('gameStart', () => {
            console.log('Game started, sending clientReady');
            socket.emit('clientReady');
        });

        // 监听发牌
        socket.on('receiveCard', ({ card, cardIndex, totalCards }) => {
            console.log('Received card:', card, 'at index:', cardIndex);
            setDealingProgress(cardIndex / totalCards);
            setCurrentCard(card);
        });

        // 监听发牌进度
        socket.on('dealingProgress', ({ currentRound, totalRounds }) => {
            console.log('Dealing progress:', currentRound, '/', totalRounds);
            setDealingProgress(currentRound / totalRounds);
        });

        // 监听叫主
        socket.on('mainCalled', ({ mainSuit, mainCaller, mainCards, counterMainDeadline }) => {
            console.log('Main called:', { mainSuit, mainCaller, mainCards });
            setGameState(prev => ({
                ...prev,
                mainSuit,
                mainCaller,
                mainCards,
                counterMainDeadline
            }));
        });

        // 监听反主
        socket.on('mainCountered', ({ mainCaller, mainCards, counterMainDeadline }) => {
            console.log('Main countered:', { mainCaller, mainCards });
            setGameState(prev => ({
                ...prev,
                mainCaller,
                mainCards,
                counterMainDeadline
            }));
        });

        // 监听加固
        socket.on('mainFixed', () => {
            console.log('Main fixed');
            setGameState(prev => ({
                ...prev,
                isMainFixed: true
            }));
        });

        // 监听抢主
        socket.on('mainStolen', ({ mainCaller, mainCards }) => {
            console.log('Main stolen:', { mainCaller, mainCards });
            setGameState(prev => ({
                ...prev,
                mainCaller,
                mainCards
            }));
        });

        // 监听粘主
        socket.on('cardsStuck', ({ playerId, cards }) => {
            console.log('Cards stuck:', { playerId, cards });
            setGameState(prev => ({
                ...prev,
                stuckCards: cards
            }));
        });

        // 监听游戏状态更新
        socket.on('updateGameState', (newState) => {
            console.log('Game state updated:', newState);
            setGameState(prev => ({
                ...prev,
                ...newState
            }));
        });

        // 监听房间信息更新
        socket.on('roomInfo', (roomInfo) => {
            console.log('Room info updated:', roomInfo);
            setPlayers(roomInfo.players);
        });

        // 监听测试游戏创建成功
        socket.on('testGameCreated', ({ roomId: newRoomId, message }) => {
            console.log('Test game created in GameLayout, roomId:', newRoomId);
            localStorage.setItem('roomId', newRoomId);
            setRoomId(newRoomId);
            socket.emit('testGameRoomIdReceived');
            
            // 显示测试模式提示
            if (message) {
                toast({
                    title: '测试模式',
                    description: message,
                    status: 'info',
                    duration: 5000,
                    isClosable: true,
                });
            }
        });

        // 组件卸载时清理
        return () => {
            if (roomId) {
                socket.emit('leaveRoom', roomId);
            }
            socket.off('gameStart');
            socket.off('receiveCard');
            socket.off('dealingProgress');
            socket.off('mainCalled');
            socket.off('mainCountered');
            socket.off('mainFixed');
            socket.off('mainStolen');
            socket.off('cardsStuck');
            socket.off('updateGameState');
            socket.off('roomInfo');
            socket.off('testGameCreated');
        };
    }, [roomId, navigate, toast]);

    return (
        <div>
            {/* Render your component content here */}
        </div>
    );
};

export default GameLayout;
