import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from './IconButton';
import { Input, type InputProps } from './Input';

/** Password field with a show/hide button, so long passphrases can be checked before sending. */
export function PasswordInput(props: Omit<InputProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      spellCheck={false}
      autoCapitalize="none"
      trailing={
        <IconButton
          label={visible ? 'Hide password' : 'Show password'}
          icon={visible ? <EyeOff /> : <Eye />}
          size="xs"
          tooltip={false}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="-mr-1.5"
        />
      }
    />
  );
}
