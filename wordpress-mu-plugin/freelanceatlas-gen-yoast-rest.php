<?php
/**
 * Plugin Name: FreelanceAtlas Gen — Yoast REST bridge
 * Description: Exposes Yoast SEO title + meta description to the WordPress REST
 *              API so the FreelanceAtlas-Gen dashboard can set them when it
 *              creates a draft post. Drop this file in wp-content/mu-plugins/.
 * Author: FreelanceAtlas
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'init', function () {
	$meta_keys = array( '_yoast_wpseo_title', '_yoast_wpseo_metadesc' );

	foreach ( $meta_keys as $key ) {
		register_post_meta(
			'post',
			$key,
			array(
				'type'          => 'string',
				'single'        => true,
				'show_in_rest'  => true,
				// Only users who can edit posts may write these via REST.
				'auth_callback' => function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}
} );
