import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Input,
  VStack,
  Container,
  Heading,
} from '@chakra-ui/react';
import { useAuth } from '../context/AuthContext';

const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState('');

  const handleLogin = () => {
    if (username.trim()) {
      login({ username: username.trim() });
      navigate('/lobby');
    }
  };

  return (
    <Container maxW="container.sm" py={8}>
      <VStack spacing={8}>
        <Heading>登录</Heading>
        <Box w="100%">
          <VStack spacing={4}>
            <Input
              placeholder="输入用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Button
              colorScheme="blue"
              width="100%"
              onClick={handleLogin}
              isDisabled={!username.trim()}
            >
              进入游戏
            </Button>
          </VStack>
        </Box>
      </VStack>
    </Container>
  );
};

export default LoginPage;