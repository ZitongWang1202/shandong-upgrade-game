import React from 'react';
import { Box, VStack, HStack, Text } from '@chakra-ui/react';
import Card from '../components/Game/Card';

function TestPage() {
    const testCards = [
        { suit: 'BACK', value: '' },
        { suit: 'diamonds', value: '2' },
        { suit: 'JOKER', value: 'BIG' },
        { suit: 'hearts', value: 'A' },
    ];

    return (
        <Box p={4}>
            <Text fontSize="xl" mb={4}>卡牌测试</Text>
            <HStack spacing={4}>
                {testCards.map((card, index) => (
                    <VStack key={index}>
                        <Card 
                            suit={card.suit} 
                            value={card.value} 
                            className="card"
                        />
                        <Text>{`${card.suit} ${card.value}`}</Text>
                    </VStack>
                ))}
            </HStack>
        </Box>
    );
}

export default TestPage;