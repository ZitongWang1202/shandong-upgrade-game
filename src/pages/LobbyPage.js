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

  // 添加新的测试游戏函数
  const createFixTestGame = () => {
    console.log('Creating fix main test game with bots');
    socket.emit('createFixTestGame');
  };

  const createCounterTestGame = () => {
    console.log('Creating counter main test game with bots');
    socket.emit('createCounterTestGame');
  };

  // 创建机器人加固测试游戏
  const createBotFixTestGame = () => {
    console.log('Creating bot fix main test game');
    socket.emit('createBotFixTestGame');
  };

  // 创建粘牌测试游戏
  const createStickTestGame = () => {
    console.log('Creating stick test game');
    socket.emit('createStickTestGame');
  };

  //  创建抠底测试游戏
  const createBottomTestGame = () => {
    console.log('Creating bottom test game');
    socket.emit('createBottomTestGame');
  };

  // 创建出牌测试游戏
  const createPlayingTestGame = () => {
    console.log('Creating playing test game');
    socket.emit('createPlayingTest');
  };

  // 创建跟随测试游戏
  const createFollowTestGame = () => {
    console.log('Creating follow test game');
    socket.emit('createFollowTestGame');
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
            <Tooltip label="加固测试：获得一张大王和两张红桃A，在第10张牌收到第二张大王" hasArrow>
              <Button colorScheme="green" onClick={createFixTestGame}>
                加固测试
              </Button>
            </Tooltip>
            <Tooltip label="反主测试：机器人叫主，玩家有两张小王和两张黑桃A可以反主" hasArrow>
              <Button colorScheme="red" onClick={createCounterTestGame}>
                反主测试
              </Button>
            </Tooltip>
            <Tooltip label="机器人加固测试：机器人叫主并加固，测试客户端反应" hasArrow>
              <Button colorScheme="orange" onClick={createBotFixTestGame}>
                机器人加固
              </Button>
            </Tooltip>
            <Tooltip label="粘牌测试：机器人叫主，玩家有小王和黑桃6677可以粘牌" hasArrow>
              <Button colorScheme="teal" onClick={createStickTestGame}>
                粘牌测试
              </Button>
            </Tooltip>
            <Tooltip label="抠底测试：对家叫主后进入抠底阶段" hasArrow>
              <Button
                colorScheme="yellow" onClick={createBottomTestGame}>
                抠底测试
              </Button>
            </Tooltip>
            <Tooltip label="出牌测试：直接进入出牌阶段" hasArrow>
              <Button
                colorScheme="pink" onClick={createPlayingTestGame}>
                出牌测试
              </Button>
            </Tooltip>
            <Tooltip label="跟牌测试：机器人叫主" hasArrow>
              <Button
                colorScheme="purple" onClick={createFollowTestGame}>
                跟牌测试
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