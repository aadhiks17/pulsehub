import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/AuthContext';
import { api, getToken, WS_BASE, formatApiError } from '../../src/api';
import { Colors } from '../../src/theme';

interface ChatMessage { id: string; sender_id: string; content: string; created_at: string; }

export default function ChatScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?._id || user?.id || '';
  const [isPremium, setIsPremium] = useState<boolean | null>(null);
  const [thread, setThread] = useState<any>(null);
  const [doctorId, setDoctorId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const premiumFlag = user?.premium;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const profRes = await api.get(`/patients/${userId}`);
        const premium = !!profRes.data?.profile?.premium;
        if (!cancelled) {
          setIsPremium(premium);
          setDoctorId(profRes.data?.profile?.assigned_doctor_id || '');
        }
        if (premium) {
          const threadRes = await api.get(`/chat/threads/by-patient/${userId}`);
          if (!cancelled) setThread(threadRes.data);
        }
      } catch (e: any) { if (!cancelled) setError(formatApiError(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, premiumFlag]);

  useEffect(() => {
    if (!thread?.thread_id) return;
    api.get(`/chat/threads/${thread.thread_id}/messages?limit=200`).then((r) => setMessages(r.data)).catch(() => {});
  }, [thread]);

  useEffect(() => {
    if (!thread?.thread_id) return;
    let ws: WebSocket | null = null;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const url = `${WS_BASE}/ws/chat/${encodeURIComponent(thread.thread_id)}?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'message') {
            setMessages((cur) => {
              if (cur.some((m) => m.id === msg.id)) return cur;
              return [...cur, { id: msg.id, sender_id: msg.sender_id, content: msg.content, created_at: msg.created_at }];
            });
          }
        } catch {}
      };
    })();
    return () => { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); };
  }, [thread]);

  useEffect(() => {
    if (messages.length > 0) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  const send = () => {
    const content = draft.trim();
    if (!content || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ content, recipient_id: doctorId }));
    setDraft('');
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const mine = item.sender_id === userId;
    return (
      <View style={[st.msgRow, mine ? st.msgRowR : st.msgRowL]} testID={`chat-msg-${item.id}`}>
        <View style={[st.bubble, mine ? st.bubbleMine : st.bubbleTheirs]}>
          <Text style={[st.msgTxt, mine ? st.msgTxtMine : st.msgTxtTheirs]}>{item.content}</Text>
          <Text style={[st.msgTime, mine ? st.msgTimeMine : st.msgTimeTheirs]}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        </View>
      </View>
    );
  };

  if (loading) return <SafeAreaView style={st.safe}><View style={st.center} testID="chat-loading"><ActivityIndicator size="large" color={Colors.primary} /><Text style={st.loadTxt}>Loading chat…</Text></View></SafeAreaView>;

  // PAYWALL for free users
  if (isPremium === false) {
    return (
      <SafeAreaView style={st.safe}>
        <View style={st.container} testID="chat-paywall">
          <View style={st.chatHdr}>
            <Ionicons name="lock-closed" size={18} color={Colors.textTertiary} />
            <Text style={st.chatHdrTxt}>Secure Chat</Text>
            <Text style={st.chatHdrSub}>Premium only</Text>
          </View>
          <View style={st.paywallBody}>
            <View style={st.paywallIcon}>
              <Ionicons name="chatbubbles-outline" size={48} color={Colors.textTertiary} />
            </View>
            <Text style={st.paywallTitle}>Upgrade to Premium</Text>
            <Text style={st.paywallDesc}>
              Message your doctor in real time with our secure end-to-end encrypted chat.
            </Text>
            <TouchableOpacity
              testID="chat-upgrade-btn"
              style={st.upgradeBtn}
              onPress={() => router.push('/upgrade')}
              activeOpacity={0.8}
            >
              <Ionicons name="star" size={16} color={Colors.white} />
              <Text style={st.upgradeBtnTxt}>Upgrade</Text>
            </TouchableOpacity>
          </View>
          {/* Disabled input bar */}
          <View style={[st.inputBar, { opacity: 0.4 }]} testID="chat-form-disabled">
            <TextInput style={st.chatInput} placeholder="Premium feature…" placeholderTextColor={Colors.textTertiary} editable={false} />
            <View style={[st.sendBtn, st.sendBtnOff]}>
              <Ionicons name="send" size={18} color={Colors.textTertiary} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // FULL CHAT for premium users
  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={st.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={st.container} testID="chat-panel">
          <View style={st.chatHdr}>
            <Ionicons name="shield-checkmark" size={18} color={Colors.normal} />
            <Text style={st.chatHdrTxt}>Secure Chat</Text>
            <Text style={st.chatHdrSub}>with your doctor</Text>
          </View>
          {error ? <View style={st.errBox}><Text style={st.errTxt}>{error}</Text></View> : null}
          <FlatList ref={flatListRef} data={messages} keyExtractor={(i) => i.id} renderItem={renderMessage} style={st.msgList} contentContainerStyle={st.msgListInner}
            ListEmptyComponent={<View style={st.empty}><Ionicons name="chatbubble-outline" size={40} color={Colors.textTertiary} /><Text style={st.emptyTxt}>No messages yet.</Text><Text style={st.emptySub}>Send a message to your doctor.</Text></View>} />
          <View style={st.inputBar} testID="chat-form">
            <TextInput testID="chat-input" style={st.chatInput} value={draft} onChangeText={setDraft} placeholder="Type a message…" placeholderTextColor={Colors.textTertiary} multiline maxLength={1000} />
            <TouchableOpacity testID="chat-send-btn" style={[st.sendBtn, !draft.trim() && st.sendBtnOff]} onPress={send} disabled={!draft.trim()} activeOpacity={0.7}>
              <Ionicons name="send" size={18} color={draft.trim() ? Colors.white : Colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadTxt: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  container: { flex: 1 },
  chatHdr: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface },
  chatHdrTxt: { fontSize: 16, fontWeight: '600', color: Colors.text },
  chatHdrSub: { fontSize: 13, color: Colors.textSecondary },
  errBox: { backgroundColor: Colors.criticalBg, borderWidth: 1, borderColor: Colors.criticalBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, margin: 16 },
  errTxt: { color: Colors.critical, fontSize: 13 },
  msgList: { flex: 1 },
  msgListInner: { padding: 16, paddingBottom: 8 },
  msgRow: { marginBottom: 8 },
  msgRowR: { alignItems: 'flex-end' },
  msgRowL: { alignItems: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  msgTxt: { fontSize: 14, lineHeight: 20 },
  msgTxtMine: { color: Colors.white },
  msgTxtTheirs: { color: Colors.text },
  msgTime: { fontSize: 10, marginTop: 4 },
  msgTimeMine: { color: 'rgba(255,255,255,0.5)' },
  msgTimeTheirs: { color: Colors.textTertiary },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyTxt: { fontSize: 15, color: Colors.textSecondary, marginTop: 12 },
  emptySub: { fontSize: 13, color: Colors.textTertiary, marginTop: 4 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.surface },
  chatInput: { flex: 1, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: Colors.text, maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: Colors.borderLight },
  // Paywall
  paywallBody: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  paywallIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  paywallTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  paywallDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.warning, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, minHeight: 48 },
  upgradeBtnTxt: { color: Colors.white, fontSize: 15, fontWeight: '600' },
});
