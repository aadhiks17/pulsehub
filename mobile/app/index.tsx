import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/AuthContext';
import { Colors } from '../src/theme';

export default function Index() {
  const { user, bootstrapping } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (bootstrapping) return;
    if (user && user.role === 'patient') {
      router.replace('/(tabs)');
    } else {
      router.replace('/login');
    }
  }, [user, bootstrapping]);

  return (
    <View style={styles.container} testID="splash-screen">
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
