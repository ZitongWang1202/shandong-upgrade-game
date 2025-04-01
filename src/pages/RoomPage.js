import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Text,
  VStack,
  HStack,
  Container,
  SimpleGrid,
  useToast,
} from '@chakra-ui/react';
import socket from '../utils/socket';

const RoomPage = () => {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [players, setPlayers] = useState([]);
  const [myPlayer, setMyPlayer] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // 获取房间信息的函数
  const getRoomInfo = useCallback(() => {
    console.log('Getting room info for:', roomId);
    socket.emit('getRoomInfo', roomId);
  }, [roomId]);
  
  useEffect(() => {
    console.log("RoomPage mounted, joining room:", roomId);
    
    // 加入房间
    socket.emit('joinRoom', roomId);
    
    // 监听房间信息更新
    socket.on('roomInfo', (roomInfo) => {
      console.log('Room info received:', roomInfo);
      if (roomInfo && roomInfo.players) {
        // 更新玩家列表
        setPlayers(roomInfo.players);
        
        // 找到自己的玩家信息
        const me = roomInfo.players.find(p => p.id === socket.id);
        if (me) {
          setMyPlayer(me);
          console.log('Found my player info:', me);
        } else {
          console.log('Could not find my player info in room data');
        }
      }
    });

    // 监听游戏开始
    socket.on('gameStart', () => {
      console.log('Game starting, navigating to game page');
      navigate('/game', { replace: true });
    });
    
    // 监听加入房间成功
    socket.on('joinRoomSuccess', (joinedRoomId) => {
      console.log('Successfully joined room:', joinedRoomId);
      localStorage.setItem('roomId', joinedRoomId);
      // 获取最新的房间信息
      getRoomInfo();
    });
    
    // 监听错误
    socket.on('joinRoomError', (error) => {
      console.error('Failed to join room:', error);
      toast({
        title: '加入房间失败',
        description: error.error,
        status: 'error',
        duration: 3000,
        isClosable: true,
      });
    });

    // 初始获取房间信息
    getRoomInfo();

    // 清理函数
    return () => {
      console.log('RoomPage unmounting, leaving room:', roomId);
      socket.off('roomInfo');
      socket.off('gameStart');
      socket.off('joinRoomSuccess');
      socket.off('joinRoomError');
    };
  }, [roomId, navigate, getRoomInfo, toast]);

  const toggleReady = () => {
    if (isLoading) return; // 防止重复点击
    
    setIsLoading(true);
    console.log('Toggling ready state for room:', roomId);
    
    socket.emit('toggleReady', roomId);
    
    // 1秒后自动解除加载状态，以防服务器没有响应
    setTimeout(() => {
      setIsLoading(false);
    }, 1000);
  };

  const leaveRoom = () => {
    console.log('Leaving room:', roomId);
    socket.emit('leaveRoom', roomId);
    navigate('/lobby');
  };

  // 填充空位置直到4个玩家
  const filledPlayers = [...players];
  while (filledPlayers.length < 4) {
    filledPlayers.push({ id: `empty-${filledPlayers.length}`, name: '等待加入...' });
  }

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
          {filledPlayers.map((player) => (
            <Box
              key={player.id}
              p={4}
              border="1px"
              borderColor="gray.200"
              borderRadius="md"
              bg={player.id === socket.id ? 'blue.50' : 'white'}
            >
              <HStack justify="space-between">
                <Text>
                  {player.name} 
                  {player.id === socket.id ? '(我)' : ''}
                </Text>
                <Text color={player.ready ? 'green.500' : 'red.500'}>
                  {player.id.startsWith('empty-') ? '' : (player.ready ? '已准备' : '未准备')}
                </Text>
              </HStack>
            </Box>
          ))}
        </SimpleGrid>

        <Button
          colorScheme={myPlayer?.ready ? 'red' : 'green'}
          onClick={toggleReady}
          size="lg"
          isLoading={isLoading}
          loadingText="处理中..."
          isDisabled={!myPlayer}
        >
          {myPlayer?.ready ? '取消准备' : '准备'}
        </Button>
      </VStack>
    </Container>
  );
};

export default RoomPage;