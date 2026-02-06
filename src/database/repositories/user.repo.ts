import { supabase } from '../client.js';
import type { User } from '../../types/index.js';

export interface CreateUserInput {
  phoneNumber: string;
  name?: string;
}

export async function findUserByPhone(phoneNumber: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = not found
    console.error('[UserRepo] Error finding user:', error);
    throw error;
  }

  return data as User | null;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .insert({
      phone_number: input.phoneNumber,
      name: input.name,
    })
    .select()
    .single();

  if (error) {
    console.error('[UserRepo] Error creating user:', error);
    throw error;
  }

  return data as User;
}

export async function findOrCreateUser(phoneNumber: string, name?: string): Promise<User> {
  let user = await findUserByPhone(phoneNumber);

  if (!user) {
    user = await createUser({ phoneNumber, name });
    console.log(`[UserRepo] Created new user: ${phoneNumber}`);
  } else if (name && !user.name) {
    // Update name if we have it and user doesn't
    const { data, error } = await supabase
      .from('users')
      .update({ name })
      .eq('id', user.id)
      .select()
      .single();

    if (!error && data) {
      user = data as User;
    }
  }

  return user;
}

export async function updateUserName(userId: string, name: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .update({ name })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error('[UserRepo] Error updating user name:', error);
    throw error;
  }

  return data as User | null;
}
