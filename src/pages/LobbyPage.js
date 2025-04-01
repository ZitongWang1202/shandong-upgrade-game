import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Text,
  VStack,
  HStack,
  Container,
  Heading,
  SimpleGrid,
  Tooltip,
} from '@chakra-ui/react';
import socket from '../utils/socket';

const LobbyPage = () => {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  
  useEffect(() => {
    // 获取房间列表
    socket.emit('getRooms');
    
    // 监听房间列表更新
    socket.on('roomList', (roomList) => {
      setRooms(roomList);
    });

    // 监听加入房间成功
    socket.on('joinRoomSuccess', (roomId) => {
      navigate(`/room/${roomId}`);
    });

    // 监听测试游戏创建成功
    socket.on('testGameCreated', ({ roomId }) => {
      console.log('Test game created, roomId:', roomId);
      localStorage.setItem('roomId', roomId);
      socket.emit('testGameRoomIdReceived');
    });

    // 监听游戏开始 - 用于测试模式直接跳转
    socket.on('gameStart', () => {
      console.log('Test game starting, navigating to game page');
      navigate('/game', { replace: true });
    });

    return () => {
      socket.off('roomList');
      socket.off('joinRoomSuccess');
      socket.off('testGameCreated');
      socket.off('gameStart');
    };
  }, [navigate]);

  const createRoom = () => {
    socket.emit('createRoom');
  };

  const joinRoom = (roomId) => {
    socket.emit('joinRoom', roomId);
  };
  
  // 创建测试游戏
  const createTestGame = () => {
    console.log('Creating test game with bots');
    socket.emit('createTestGame');
  };

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={8} align="stretch">
        <HStack justify="space-between">
          <Heading>游戏大厅</Heading>
          <HStack>
            <Button colorScheme="blue" onClick={createRoom}>
              创建房间
            </Button>
            <Tooltip label="创建带有3个机器人的测试游戏，直接进入发牌阶段" hasArrow>
              <Button colorScheme="purple" onClick={createTestGame}>
                一键测试
              </Button>
            </Tooltip>
          </HStack>
        </HStack>

        <SimpleGrid columns={3} spacing={4}>
          {rooms.map((room) => (
            <Box 
              key={room.id}
              p={4}
              border="1px"
              borderColor="gray.200"
              borderRadius="md"
            >
              <VStack align="stretch">
                <Text>房间号: {room.id}</Text>
                <Text>玩家数: {room.players.length}/4</Text>
                <Button
                  colorScheme="green"
                  isDisabled={room.players.length >= 4}
                  onClick={() => joinRoom(room.id)}
                >
                  加入房间
                </Button>
              </VStack>
            </Box>
          ))}
        </SimpleGrid>
      </VStack>
    </Container>
  );
};

export default LobbyPage;