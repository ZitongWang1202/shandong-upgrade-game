import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Text,
  VStack,
  HStack,
  Container,
  SimpleGrid,
} from '@chakra-ui/react';
import socket from '../utils/socket';

const RoomPage = () => {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [isReady, setIsReady] = useState(false);
  
  useEffect(() => {
    // 获取房间信息
    socket.emit('getRoomInfo', roomId);
    
    // 监听房间信息更新
    socket.on('roomInfo', (roomInfo) => {
      console.log('Room info updated:', roomInfo);
      setPlayers(roomInfo.players);
    });

    // 监听游戏开始
    socket.on('gameStart', () => {
      console.log('Received gameStart event, preparing to navigate');
      // 使用 replace 而不是 push，避免历史记录堆栈
      navigate('/game', { replace: true });
    });

    // 在加入房间成功后保存 roomId
    socket.on('joinRoomSuccess', (roomId) => {
      console.log('Successfully joined room:', roomId);
      localStorage.setItem('roomId', roomId);
    });

    // 清理函数
    return () => {
      socket.off('roomInfo');
      socket.off('gameStart');
    };
  }, [roomId, navigate]);

  const toggleReady = () => {
    console.log('Toggling ready state');
    setIsReady(!isReady);
    socket.emit('toggleReady', roomId);
  };

  const leaveRoom = () => {
    socket.emit('leaveRoom', roomId);
    navigate('/lobby');
  };

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={8} align="stretch">
        <HStack justify="space-between">
          <Text fontSize="2xl">房间号: {roomId}</Text>
          <Button colorScheme="red" onClick={leaveRoom}>
            离开房间
          </Button>
        </HStack>

        <SimpleGrid columns={2} spacing={4}>
          {players.map((player, index) => (
            <Box
              key={index}
              p={4}
              border="1px"
              borderColor="gray.200"
              borderRadius="md"
            >
              <HStack justify="space-between">
                <Text>玩家 {player.name}</Text>
                <Text color={player.ready ? 'green.500' : 'red.500'}>
                  {player.ready ? '已准备' : '未准备'}
                </Text>
              </HStack>
            </Box>
          ))}
        </SimpleGrid>

        <Button
          colorScheme={isReady ? 'red' : 'green'}
          onClick={toggleReady}
        >
          {isReady ? '取消准备' : '准备'}
        </Button>
      </VStack>
    </Container>
  );
};

export default RoomPage;