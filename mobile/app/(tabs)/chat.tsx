import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/AuthContext';
import { api, getToken, WS_BASE, formatApiError } from '../../src/api';
import { Colors } from '../../src/theme';

interface ChatMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export default function ChatScreen() {
  const { user } = useAuth();
  const userId = user?._id || user?.id || '';
  const [thread, setThread] = useState<any>(null);
  const [doctorId, setDoctorId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // Load patient profile to get doctor ID, then thread
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      try {
        // Get patient profile for assigned_doctor_id
        const profileRes = await api.get(`/patients/${userId}`);
        const docId = profileRes.data?.profile?.assigned_doctor_id;
        if (docId && !cancelled) setDoctorId(docId);

        // Get chat thread
        const threadRes = await api.get(`/chat/threads/by-patient/${userId}`);
        if (!cancelled) setThread(threadRes.data);
      } catch (e: any) {
        if (!cancelled) setError(formatApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Load message history
  useEffect(() => {
    if (!thread?.thread_id) return;
    api
      .get(`/chat/threads/${thread.thread_id}/messages?limit=200`)
      .then((r) => setMessages(r.data))
      .catch(() => {});
  }, [thread]);

  // WebSocket for live chat
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
              return [
                ...cur,
                {
                  id: msg.id,
                  sender_id: msg.sender_id,
                  content: msg.content,
                  created_at: msg.created_at,
                },
              ];
            });
          }
        } catch {}
      };
    })();

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, [thread]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const send = () => {
    const content = draft.trim();
    if (!content || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        content,
        recipient_id: doctorId,
      }),
    );
    setDraft('');
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const mine = item.sender_id === userId;
    return (
      <View
        style={[styles.msgRow, mine ? styles.msgRowRight : styles.msgRowLeft]}
        testID={`chat-msg-${item.id}`}
      >
        <View style={[styles.msgBubble, mine ? styles.msgBubbleMine : styles.msgBubbleTheirs]}>
          <Text style={[styles.msgText, mine ? styles.msgTextMine : styles.msgTextTheirs]}>
            {item.content}
          </Text>
          <Text style={[styles.msgTime, mine ? styles.msgTimeMine : styles.msgTimeTheirs]}>
            {new Date(item.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center} testID="chat-loading">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading chat…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.container} testID="chat-panel">
          {/* Header */}
          <View style={styles.chatHeader}>
            <Ionicons name="shield-checkmark" size={18} color={Colors.normal} />
            <Text style={styles.chatHeaderText}>Secure Chat</Text>
            <Text style={styles.chatHeaderSub}>with your doctor</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Messages */}
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            style={styles.msgList}
            contentContainerStyle={styles.msgListContent}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Ionicons name="chatbubble-outline" size={40} color={Colors.textTertiary} />
                <Text style={styles.emptyChatText}>No messages yet.</Text>
                <Text style={styles.emptyChatSub}>Send a message to your doctor.</Text>
              </View>
            }
          />

          {/* Input */}
          <View style={styles.inputBar} testID="chat-form">
            <TextInput
              testID="chat-input"
              style={styles.chatInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message…"
              placeholderTextColor={Colors.textTertiary}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              testID="chat-send-btn"
              style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!draft.trim()}
              activeOpacity={0.7}
            >
              <Ionicons
                name="send"
                size={18}
                color={draft.trim() ? Colors.white : Colors.textTertiary}
              />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: Colors.textSecondary },
  container: { flex: 1 },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chatHeaderText: { fontSize: 16, fontWeight: '600', color: Colors.text },
  chatHeaderSub: { fontSize: 13, color: Colors.textSecondary },
  errorBox: {
    backgroundColor: Colors.criticalBg,
    borderWidth: 1,
    borderColor: Colors.criticalBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    margin: 16,
  },
  errorText: { color: Colors.critical, fontSize: 13 },
  msgList: { flex: 1 },
  msgListContent: { padding: 16, paddingBottom: 8 },
  msgRow: { marginBottom: 8 },
  msgRowRight: { alignItems: 'flex-end' },
  msgRowLeft: { alignItems: 'flex-start' },
  msgBubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  msgBubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  msgBubbleTheirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  msgText: { fontSize: 14, lineHeight: 20 },
  msgTextMine: { color: Colors.white },
  msgTextTheirs: { color: Colors.text },
  msgTime: { fontSize: 10, marginTop: 4 },
  msgTimeMine: { color: 'rgba(255,255,255,0.5)' },
  msgTimeTheirs: { color: Colors.textTertiary },
  emptyChat: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyChatText: { fontSize: 15, color: Colors.textSecondary, marginTop: 12 },
  emptyChatSub: { fontSize: 13, color: Colors.textTertiary, marginTop: 4 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chatInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.borderLight },
});
