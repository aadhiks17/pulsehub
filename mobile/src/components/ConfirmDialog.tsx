import { View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Colors } from '../theme';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  visible, title, message,
  confirmText = 'Confirm', cancelText = 'Cancel',
  destructive = false, onConfirm, onCancel,
}: Props) {
  if (!visible) return null;

  return (
    <View style={s.overlay}>
      <Pressable style={s.backdrop} onPress={onCancel} />
      <View style={s.dialog}>
        <Text style={s.title} testID="confirm-dialog-title">{title}</Text>
        <Text style={s.message}>{message}</Text>
        <View style={s.buttons}>
          <TouchableOpacity
            testID="confirm-dialog-cancel"
            style={s.cancelBtn}
            onPress={onCancel}
            activeOpacity={0.7}
          >
            <Text style={s.cancelTxt}>{cancelText}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="confirm-dialog-confirm"
            style={[s.confirmBtn, destructive && s.destructiveBtn]}
            onPress={onConfirm}
            activeOpacity={0.7}
          >
            <Text style={[s.confirmTxt, destructive && s.destructiveTxt]}>
              {confirmText}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: 32,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  dialog: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    zIndex: 1001,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.background,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelTxt: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  confirmTxt: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.white,
  },
  destructiveBtn: {
    backgroundColor: Colors.critical,
  },
  destructiveTxt: {
    color: Colors.white,
  },
});
