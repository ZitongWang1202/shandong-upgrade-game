import React from 'react';
import { Box, HStack, Button, useToast } from '@chakra-ui/react';
import { useHistory } from 'react-router-dom';

function NavBar() {
    const history = useHistory();
    const toast = useToast();

    const handleLogout = () => {
        localStorage.removeItem('user');
        toast({
            title: "已退出登录",
            status: "info",
            duration: 2000,
        });
        history.push('/login');
    };

    return (
        <Box bg="gray.100" px={4} py={2}>
            <HStack justify="space-between">
                <Button variant="ghost" onClick={() => history.push('/lobby')}>
                    返回大厅
                </Button>
                <Button colorScheme="red" onClick={handleLogout}>
                    退出登录
                </Button>
            </HStack>
        </Box>
    );
}

export default NavBar;